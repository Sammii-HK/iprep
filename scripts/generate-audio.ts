#!/usr/bin/env npx tsx
// ============================================================
// Generate audio study sessions for iPrep question banks
//
// Usage:
//   npx tsx scripts/generate-audio.ts --bank <bank-id>              # From production DB
//   npx tsx scripts/generate-audio.ts --bank all                    # All banks from production DB
//   npx tsx scripts/generate-audio.ts --csv public/banks/file.csv --id <id>  # From CSV
//   npx tsx scripts/generate-audio.ts --bank <id> --duration 20min  # Custom duration
// ============================================================

import { config } from 'dotenv';
config({ path: '.env.production.local' });
config({ path: '.env.local' });
config();

import { readFile } from 'fs/promises';
import { join } from 'path';
import { parse } from 'papaparse';
import { uploadStudyAudio } from '../lib/r2';

const PODIFY_DIR = join(process.cwd(), '..', 'podify');

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
      args[key] = val;
      if (val !== 'true') i++;
    }
  }
  return args;
}

async function loadBankFromCSV(csvPath: string): Promise<{ title: string; content: string }> {
  const raw = await readFile(csvPath, 'utf-8');
  const { data } = parse(raw, { header: true, skipEmptyLines: true });
  const rows = data as Record<string, string>[];
  const title = csvPath.split('/').pop()?.replace('.csv', '').replace(/-/g, ' ') || 'Study Session';
  const content = rows
    .map((row, i) => {
      const front = row.front || row.text || '';
      const back = row.back || row.hint || '';
      return `Question ${i + 1}: ${front}\nAnswer: ${back}`;
    })
    .join('\n\n');
  return { title, content };
}

async function loadBankFromDB(bankId: string): Promise<{ id: string; title: string; content: string }> {
  const dbUrl = process.env.DATABASE_URL || process.env.DATABASE_POSTGRES_URL;
  if (!dbUrl) throw new Error('No DATABASE_URL found in env');

  // Use pg directly to avoid Prisma client generation issues
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const bankResult = await client.query(
    'SELECT id, title FROM "QuestionBank" WHERE id = $1',
    [bankId]
  );
  if (bankResult.rows.length === 0) {
    await client.end();
    throw new Error(`Bank ${bankId} not found`);
  }

  const bank = bankResult.rows[0];
  const questionsResult = await client.query(
    'SELECT text, hint FROM "Question" WHERE "bankId" = $1 ORDER BY id',
    [bankId]
  );
  await client.end();

  const content = questionsResult.rows
    .map((q: { text: string; hint: string | null }, i: number) => {
      const answer = q.hint ? `\nAnswer: ${q.hint}` : '';
      return `Question ${i + 1}: ${q.text}${answer}`;
    })
    .join('\n\n');

  return { id: bank.id, title: bank.title, content };
}

async function listAllBanks(): Promise<{ id: string; title: string; questionCount: number }[]> {
  const dbUrl = process.env.DATABASE_URL || process.env.DATABASE_POSTGRES_URL;
  if (!dbUrl) throw new Error('No DATABASE_URL found in env');

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const result = await client.query(`
    SELECT qb.id, qb.title, COUNT(q.id)::int as question_count
    FROM "QuestionBank" qb
    LEFT JOIN "Question" q ON q."bankId" = qb.id
    GROUP BY qb.id, qb.title
    ORDER BY qb.title
  `);
  await client.end();
  return result.rows;
}

async function generateForBank(bankId: string, title: string, content: string, duration: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Generating: ${title}`);
  console.log(`  Bank ID: ${bankId}`);
  console.log(`  Content: ${content.length} chars`);
  console.log(`  Duration: ${duration}`);
  console.log('='.repeat(60));

  const { writeFile, rm } = await import('fs/promises');
  const tmpFile = join(PODIFY_DIR, `.tmp-iprep-${bankId}.txt`);
  await writeFile(tmpFile, content);

  const { execSync } = await import('child_process');
  try {
    execSync(
      `pnpm generate --file "${tmpFile}" --format deep_review --duration ${duration} --tone casual --title "${title}" --voices orpheus_jess_zac --tts orpheus --llm deepinfra`,
      { cwd: PODIFY_DIR, stdio: 'inherit', timeout: 600_000 }
    );
  } finally {
    await rm(tmpFile, { force: true });
  }

  // Find latest output (by modification time, not name)
  const { readdirSync, statSync } = await import('fs');
  const outputDir = join(PODIFY_DIR, '.podify-output');
  const dirs = readdirSync(outputDir)
    .filter((d) => statSync(join(outputDir, d)).isDirectory())
    .sort((a, b) => statSync(join(outputDir, b)).mtimeMs - statSync(join(outputDir, a)).mtimeMs);

  const latestDir = dirs[0];
  if (!latestDir) throw new Error('No output found');

  const episodeDir = join(outputDir, latestDir);
  const mp3Files = readdirSync(episodeDir).filter((f) => f.endsWith('.mp3'));
  if (mp3Files.length === 0) throw new Error('No MP3 found');

  const mp3Buffer = await readFile(join(episodeDir, mp3Files[0]));
  let transcript: string | undefined;
  try { transcript = await readFile(join(episodeDir, 'transcript.txt'), 'utf-8'); } catch {}

  console.log(`\nUploading to R2...`);
  const { audioUrl, transcriptUrl } = await uploadStudyAudio(bankId, mp3Buffer, transcript);

  console.log(`  Audio: ${audioUrl}`);
  if (transcriptUrl) console.log(`  Transcript: ${transcriptUrl}`);
  return { audioUrl, transcriptUrl };
}

async function main() {
  const args = parseArgs();
  const duration = args.duration || '15min';

  if (args.csv && args.id) {
    const { title, content } = await loadBankFromCSV(args.csv);
    await generateForBank(args.id, title, content, duration);
    return;
  }

  if (args.bank === 'all') {
    const banks = await listAllBanks();
    console.log(`\nFound ${banks.length} banks:\n`);
    banks.forEach((b) => console.log(`  ${b.id} | ${b.title} (${b.questionCount} questions)`));
    console.log(`\nGenerating audio for all ${banks.length} banks...\n`);

    for (const bank of banks) {
      if (bank.questionCount === 0) {
        console.log(`Skipping ${bank.title} (no questions)`);
        continue;
      }
      try {
        const { content } = await loadBankFromDB(bank.id);
        await generateForBank(bank.id, bank.title, content, duration);
      } catch (err: any) {
        console.error(`\nFailed on ${bank.title}: ${err.message}\n`);
      }
      // Brief pause between banks
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log('\nAll done!');
    return;
  }

  if (args.bank) {
    const bank = await loadBankFromDB(args.bank);
    await generateForBank(bank.id, bank.title, bank.content, duration);
    return;
  }

  // List banks if no args
  const banks = await listAllBanks();
  console.log(`\nAvailable banks:\n`);
  banks.forEach((b) => console.log(`  ${b.id} | ${b.title} (${b.questionCount} questions)`));
  console.log(`\nUsage:`);
  console.log(`  npx tsx scripts/generate-audio.ts --bank <id>`);
  console.log(`  npx tsx scripts/generate-audio.ts --bank all`);
  console.log(`  npx tsx scripts/generate-audio.ts --bank <id> --duration 20min`);
}

main().catch((err) => {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(1);
});
