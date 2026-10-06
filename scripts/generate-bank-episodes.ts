#!/usr/bin/env npx tsx
// ============================================================
// Generate spoken study episodes for iPrep question banks.
//
//   npx tsx scripts/generate-bank-episodes.ts <bankId...> [options]
//   npx tsx scripts/generate-bank-episodes.ts --folder "Personio Interview Prep"
//
// Options:
//   --folder <id|title>  Expand a folder into its banks (OLD/superseded banks are skipped)
//   --status             List which banks in the folder (or every folder) have audio, and which do not. Free.
//   --dry-run            Print characters and estimated cost, generate nothing
//   --max-gbp <n>        Abort if the estimate exceeds this (default 1.00)
//   --voice <name>       Kokoro voice (default bf_emma, British English)
//   --pause <seconds>    Thinking pause after each question (default 4)
//   --force              Regenerate even if the episode is up to date, or was made by another tool
//
// How it works:
//   - Reads banks through the iPrep API (IPREP_BASE_URL + x-internal-key). No database access.
//   - Speaks question text and answer hints EXACTLY as stored, with short framing in UK English.
//   - TTS: DeepInfra hexgrad/Kokoro-82M (the repo's existing, cheapest option, ~$0.62 per 1M chars).
//   - Uploads audio/study/<bankId>.mp3, .txt (transcript) and .json (source hash) to R2.
//     The existing /api/banks/[id]/audio route and folder player already read that key.
//   - Idempotent: skipped when the stored source hash matches the current questions.
// ============================================================

import { config } from 'dotenv';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { execFileSync } from 'child_process';
import { api } from './lib/iprep-api';
import {
  DEFAULT_THINKING_PAUSE_SECONDS,
  DEFAULT_VOICE,
  TTS_MODEL,
  buildEpisodeScript,
  chunkText,
  decideEpisodeAction,
  episodeSourceHash,
  estimateCost,
  type EpisodeMeta,
} from '../lib/bank-audio';

// Env: current dir first, then the main iprep checkout next to this worktree.
for (const dir of [process.cwd(), resolve(process.cwd(), '..', 'iprep')]) {
  config({ path: join(dir, '.env.production.local'), quiet: true });
  config({ path: join(dir, '.env.local'), quiet: true });
}

interface Args {
  bankIds: string[];
  folder?: string;
  status: boolean;
  dryRun: boolean;
  force: boolean;
  maxGbp: number;
  voice: string;
  pause: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    bankIds: [],
    status: false,
    dryRun: false,
    force: false,
    maxGbp: 1.0,
    voice: DEFAULT_VOICE,
    pause: DEFAULT_THINKING_PAUSE_SECONDS,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--status') args.status = true;
    else if (a === '--force') args.force = true;
    else if (a === '--folder') args.folder = argv[++i];
    else if (a === '--max-gbp') args.maxGbp = Number(argv[++i]);
    else if (a === '--voice') args.voice = argv[++i];
    else if (a === '--pause') args.pause = Number(argv[++i]);
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else args.bankIds.push(a);
  }
  if (!Number.isFinite(args.maxGbp) || args.maxGbp <= 0) throw new Error('--max-gbp must be a positive number');
  if (!/^[a-z]{2}_[a-z]+$/.test(args.voice)) throw new Error('--voice looks invalid');
  return args;
}

interface ApiBank {
  id: string;
  title: string;
  questions: Array<{ text: string; hint: string | null }>;
}

interface ApiFolder {
  id: string;
  title: string;
  banks: Array<{ id: string; title: string }>;
}

const isSuperseded = (title: string) => /^OLD \(superseded/i.test(title);
const isArchiveFolder = (title: string) => /^Archive:/i.test(title);

async function resolveBankIds(args: Args): Promise<string[]> {
  const ids = [...args.bankIds];
  if (args.folder) {
    const folders = await api<ApiFolder[]>('/api/folders');
    const wanted = args.folder.toLowerCase();
    const folder =
      folders.find((f) => f.id === args.folder) ??
      folders.find((f) => f.title.toLowerCase() === wanted) ??
      folders.find((f) => f.title.toLowerCase().includes(wanted));
    if (!folder) throw new Error(`Folder not found: ${args.folder}`);
    if (isArchiveFolder(folder.title)) throw new Error(`Refusing to generate for archive folder: ${folder.title}`);
    for (const b of folder.banks) {
      if (isSuperseded(b.title)) {
        console.log(`  skipping superseded bank: ${b.title}`);
        continue;
      }
      ids.push(b.id);
    }
  }
  const unique = [...new Set(ids)];
  if (unique.length === 0) throw new Error('No bank ids given. Pass <bankId...> or --folder <id|title>.');
  return unique;
}

function hasR2(): boolean {
  return Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_BUCKET_NAME &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY
  );
}

async function tts(text: string, voice: string): Promise<Buffer> {
  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) throw new Error('Missing DEEPINFRA_API_KEY');
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch('https://api.deepinfra.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: TTS_MODEL, input: text, voice, response_format: 'mp3' }),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt === 3 || (res.status < 500 && res.status !== 429)) {
      throw new Error(`Kokoro request failed with ${res.status}`);
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new Error('unreachable');
}

function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

async function renderEpisode(
  segments: ReturnType<typeof buildEpisodeScript>['segments'],
  voice: string
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'iprep-episode-'));
  try {
    const listLines: string[] = [];
    let n = 0;
    for (const seg of segments) {
      const file = join(dir, `${String(n++).padStart(4, '0')}.mp3`);
      if (seg.kind === 'pause') {
        execFileSync(
          ffmpegPath(),
          ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(seg.seconds), '-c:a', 'libmp3lame', '-b:a', '64k', file]
        );
      } else {
        const parts: string[] = [];
        for (const chunk of chunkText(seg.text)) {
          parts.push(`file '${join(dir, `p${n}-${parts.length}.mp3`)}'`);
          await writeFile(join(dir, `p${n}-${parts.length - 1}.mp3`), await tts(chunk, voice));
        }
        const partList = join(dir, `p${n}.txt`);
        await writeFile(partList, parts.join('\n'));
        execFileSync(
          ffmpegPath(),
          ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', partList, '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', file]
        );
      }
      listLines.push(`file '${file}'`);
    }
    const list = join(dir, 'all.txt');
    const out = join(dir, 'episode.mp3');
    await writeFile(list, listLines.join('\n'));
    execFileSync(ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', out]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function printStatus(args: Args) {
  const { getStudyAudioState } = await import('../lib/r2');
  const all = await api<ApiFolder[]>('/api/folders');
  const wanted = args.folder?.toLowerCase();
  const folders = all.filter((f) =>
    wanted
      ? f.id === args.folder || f.title.toLowerCase() === wanted || f.title.toLowerCase().includes(wanted)
      : !isArchiveFolder(f.title)
  );
  if (folders.length === 0) throw new Error('No matching folders');
  const cache = new Map<string, string>();
  let missing = 0;
  for (const f of folders) {
    console.log(`\n${f.title}`);
    for (const b of f.banks) {
      if (isSuperseded(b.title)) continue;
      if (!cache.has(b.id)) {
        const st = await getStudyAudioState(b.id);
        cache.set(b.id, st.hasAudio ? 'audio  ' : 'MISSING');
      }
      const state = cache.get(b.id)!;
      if (state === 'MISSING') missing++;
      console.log(`  ${state}  ${b.id}  ${b.title}`);
    }
  }
  console.log(`\n${missing} bank${missing === 1 ? '' : 's'} without audio (counting repeats across folders).`);
  console.log('Generate: npx tsx scripts/generate-bank-episodes.ts --folder "<folder title>"');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.status) {
    if (!hasR2()) throw new Error('Missing R2 credentials (R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
    await printStatus(args);
    return;
  }
  const bankIds = await resolveBankIds(args);
  const r2 = hasR2();
  if (!r2) console.warn('R2 credentials not found: cannot check existing episodes; assuming none exist.');
  const { getStudyAudioState, uploadStudyAudio } = await import('../lib/r2');

  type Plan = {
    bank: ApiBank;
    script: ReturnType<typeof buildEpisodeScript>;
    hash: string;
    decision: ReturnType<typeof decideEpisodeAction>;
  };
  const plans: Plan[] = [];

  for (const id of bankIds) {
    const bank = await api<ApiBank>(`/api/banks/${id}`);
    if (bank.questions.length === 0) {
      console.log(`SKIP  ${bank.title}: no questions`);
      continue;
    }
    const script = buildEpisodeScript(bank.title, bank.questions, { pauseSeconds: args.pause });
    const hash = episodeSourceHash(script, args.voice);
    const existing = r2 ? await getStudyAudioState<EpisodeMeta>(id) : { hasAudio: false, meta: null };
    plans.push({ bank, script, hash, decision: decideEpisodeAction(existing, hash, args.force) });
  }

  let totalChars = 0;
  console.log('');
  for (const p of plans) {
    const todo = p.decision === 'generate' || p.decision === 'regenerate';
    const cost = estimateCost(p.script.characters);
    if (todo) totalChars += p.script.characters;
    console.log(
      `${todo ? p.decision.toUpperCase().padEnd(10) : p.decision.padEnd(18)} ${p.bank.title} ` +
        `(${p.bank.questions.length}q, ${p.script.characters} chars, ~${cost.pence.toFixed(2)}p)`
    );
    if (p.decision === 'skip-unmanaged') {
      console.log('   an episode exists that this tool did not create; use --force to replace it');
    }
  }
  const total = estimateCost(totalChars);
  console.log(
    `\nTo generate: ${totalChars} chars, estimated $${total.usd.toFixed(4)} (~${total.pence.toFixed(2)}p). Cap: ${args.maxGbp.toFixed(2)} GBP.`
  );

  if (total.gbp > args.maxGbp) {
    throw new Error(`Estimate ${total.gbp.toFixed(2)} GBP exceeds --max-gbp ${args.maxGbp.toFixed(2)}. Aborting.`);
  }
  if (args.dryRun) {
    console.log('Dry run, nothing generated.');
    return;
  }
  if (!r2) throw new Error('Missing R2 credentials (R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');

  let spentChars = 0;
  for (const p of plans) {
    if (p.decision !== 'generate' && p.decision !== 'regenerate') continue;
    console.log(`\nGenerating ${p.bank.title} ...`);
    const mp3 = await renderEpisode(p.script.segments, args.voice);
    const meta: EpisodeMeta = {
      sourceHash: p.hash,
      voice: args.voice,
      model: TTS_MODEL,
      characters: p.script.characters,
      questionCount: p.bank.questions.length,
      generatedAt: new Date().toISOString(),
    };
    const { audioUrl } = await uploadStudyAudio(p.bank.id, mp3, p.script.transcript, meta);
    spentChars += p.script.characters;
    console.log(`  uploaded ${(mp3.length / 1024 / 1024).toFixed(1)} MB: ${audioUrl}`);
  }
  const spent = estimateCost(spentChars);
  console.log(`\nDone. ${spentChars} chars, estimated $${spent.usd.toFixed(4)} (~${spent.pence.toFixed(2)}p).`);
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
