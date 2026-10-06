#!/usr/bin/env npx tsx
// ============================================================
// Generate spoken study episodes for iPrep question banks.
//
//   npx tsx scripts/generate-bank-episodes.ts <bankId...> [options]
//   npx tsx scripts/generate-bank-episodes.ts --folder "Personio Interview Prep"
//
// Styles:
//   dialogue (default)  Two hosts, Jess and Zac. Scripted by the Podify pipeline, voiced by Orpheus
//                       (canopylabs/orpheus-3b-0.1-ft via DeepInfra). About 7p per 10 minute episode.
//   narrator            Single coach voice, DeepInfra Kokoro (--style narrator). About 0.3p per bank.
//
// Local first: audio and transcripts are written to --out (default ~/Desktop/podcast-preview).
// NOTHING is uploaded to R2 unless you pass --upload, and a bank that fails its checks is never uploaded.
//
// Options:
//   --folder <id|title>  Expand a folder into its banks (OLD/superseded banks skipped, Archive folders refused)
//   --status             List which banks have audio and which do not, with the cost to fill the gaps. Free.
//   --dry-run            Print estimated cost, generate nothing
//   --max-gbp <n>        Abort if the estimate exceeds this (default 1.00)
//   --style <s>          dialogue (default) or narrator
//   --duration <n>min    Dialogue length target (default 10min)
//   --out <dir>          Local output folder (default ~/Desktop/podcast-preview)
//   --upload             Upload passing banks to R2 (also uploads a matching local render without regenerating)
//   --voice, --pause     Narrator only
//   --force              Regenerate even if up to date
//
// Dialogue checks after generation (a failing bank is marked "needs review" and not uploaded):
//   1. The transcript must not contain the host names Luna or Sol, or Lunary / The Grimoire branding
//      (unless the notes themselves say it).
//   2. Every number in the transcript must appear in the source notes.
// Source rules are prepended to the notes: only facts in the notes, no invented figures, dates,
// employers or outcomes, no em dashes, UK English.
//
// Idempotency: a sidecar hash (keyed by style, voices, length, notes and rules) is kept locally and in R2.
// ============================================================

import { config } from 'dotenv';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'fs/promises';
import { tmpdir, homedir } from 'os';
import { join, resolve } from 'path';
import { execFileSync } from 'child_process';
import { api } from './lib/iprep-api';
import {
  DEFAULT_DIALOGUE_MINUTES,
  DEFAULT_STYLE,
  DEFAULT_THINKING_PAUSE_SECONDS,
  DEFAULT_VOICE,
  DIALOGUE_TTS_MODEL,
  DIALOGUE_VOICES,
  TTS_MODEL,
  buildDialogueSource,
  buildEpisodeScript,
  checkDialogueTranscript,
  chunkText,
  decideBankAction,
  dialogueSourceHash,
  episodeSourceHash,
  estimateCost,
  estimateDialogueCost,
  type BankAction,
  type EpisodeMeta,
  type EpisodeStyle,
  type LocalState,
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
  upload: boolean;
  maxGbp: number;
  style: EpisodeStyle;
  minutes: number;
  out: string;
  voice: string;
  pause: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    bankIds: [],
    status: false,
    dryRun: false,
    force: false,
    upload: false,
    maxGbp: 1.0,
    style: DEFAULT_STYLE,
    minutes: DEFAULT_DIALOGUE_MINUTES,
    out: join(homedir(), 'Desktop', 'podcast-preview'),
    voice: DEFAULT_VOICE,
    pause: DEFAULT_THINKING_PAUSE_SECONDS,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--status') args.status = true;
    else if (a === '--force') args.force = true;
    else if (a === '--upload') args.upload = true;
    else if (a === '--folder') args.folder = argv[++i];
    else if (a === '--max-gbp') args.maxGbp = Number(argv[++i]);
    else if (a === '--voice') args.voice = argv[++i];
    else if (a === '--pause') args.pause = Number(argv[++i]);
    else if (a === '--out') args.out = resolve(argv[++i].replace(/^~(?=\/)/, homedir()));
    else if (a === '--duration') args.minutes = Number(argv[++i].replace(/min$/, ''));
    else if (a === '--style') {
      const v = argv[++i];
      if (v !== 'dialogue' && v !== 'narrator') throw new Error('--style must be dialogue or narrator');
      args.style = v;
    } else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else args.bankIds.push(a);
  }
  if (!Number.isFinite(args.maxGbp) || args.maxGbp <= 0) throw new Error('--max-gbp must be a positive number');
  if (!Number.isFinite(args.minutes) || args.minutes < 3 || args.minutes > 30) throw new Error('--duration must be 3 to 30 minutes');
  if (!/^[a-z]{2}_[a-z]+$/.test(args.voice)) throw new Error('--voice looks invalid');
  return args;
}

interface ApiFolder {
  id: string;
  title: string;
  banks: Array<{ id: string; title: string }>;
}

const isSuperseded = (title: string) => /^OLD \(superseded/i.test(title);
const isArchiveFolder = (title: string) => /^Archive:/i.test(title);

function findFolder(folders: ApiFolder[], ref: string): ApiFolder | undefined {
  const wanted = ref.toLowerCase();
  return (
    folders.find((f) => f.id === ref) ??
    folders.find((f) => f.title.toLowerCase() === wanted) ??
    folders.find((f) => f.title.toLowerCase().includes(wanted))
  );
}

interface ApiBank {
  id: string;
  title: string;
  questions: Array<{ text: string; hint: string | null }>;
}

async function resolveBankIds(args: Args): Promise<string[]> {
  const ids = [...args.bankIds];
  if (args.folder) {
    const folders = await api<ApiFolder[]>('/api/folders');
    const folder = findFolder(folders, args.folder);
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

// ---------- dialogue (Podify) ----------

function podifyDir(): string {
  return process.env.PODIFY_DIR || join(homedir(), 'development', 'podify');
}

async function renderDialogue(
  bank: ApiBank,
  source: string,
  minutes: number
): Promise<{ mp3: Buffer; transcript: string }> {
  const dir = podifyDir();
  if (!existsSync(join(dir, 'package.json'))) throw new Error(`Podify not found at ${dir} (set PODIFY_DIR)`);
  const outputRoot = join(dir, '.podify-output');
  const before = new Set(existsSync(outputRoot) ? readdirSync(outputRoot) : []);
  const tmpFile = join(dir, `.tmp-iprep-${bank.id}.txt`);
  await writeFile(tmpFile, source);
  try {
    execFileSync(
      'pnpm',
      [
        'generate', '--file', tmpFile, '--format', 'deep_review', '--duration', `${minutes}min`,
        '--tone', 'casual', '--title', bank.title, '--voices', DIALOGUE_VOICES, '--tts', 'orpheus', '--llm', 'deepinfra',
      ],
      { cwd: dir, stdio: 'inherit', timeout: 25 * 60_000 }
    );
  } finally {
    await rm(tmpFile, { force: true });
  }
  const fresh = readdirSync(outputRoot)
    .filter((d) => !before.has(d) && statSync(join(outputRoot, d)).isDirectory())
    .sort((a, b) => statSync(join(outputRoot, a)).mtimeMs - statSync(join(outputRoot, b)).mtimeMs);
  const latest = fresh[fresh.length - 1];
  if (!latest) throw new Error('Podify produced no new output');
  const epDir = join(outputRoot, latest);
  const mp3Name = readdirSync(epDir).find((f) => f.endsWith('.mp3'));
  if (!mp3Name) throw new Error('Podify output has no mp3');
  const transcriptPath = join(epDir, 'transcript.txt');
  const transcript = existsSync(transcriptPath) ? await readFile(transcriptPath, 'utf8') : '';
  if (!transcript) throw new Error('Podify output has no transcript, cannot run the checks');
  return { mp3: await readFile(join(epDir, mp3Name)), transcript };
}

// ---------- local state ----------

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

function localPaths(out: string, bank: { id: string; title: string }) {
  const base = join(out, `${slug(bank.title)}-${bank.id}`);
  return { mp3: `${base}.mp3`, transcript: `${base}.transcript.txt`, meta: `${base}.json`, review: `${base}.NEEDS-REVIEW.txt`, notes: `${base}.source-notes.txt` };
}

function readLocal(out: string, bank: { id: string; title: string }): LocalState | null {
  const p = localPaths(out, bank);
  if (!existsSync(p.meta) || !existsSync(p.mp3)) return null;
  try {
    const m = JSON.parse(readFileSync(p.meta, 'utf8'));
    return typeof m.sourceHash === 'string' && (m.status === 'ok' || m.status === 'needs-review')
      ? { sourceHash: m.sourceHash, status: m.status }
      : null;
  } catch {
    return null;
  }
}

async function printStatus(args: Args) {
  const { getStudyAudioState } = await import('../lib/r2');
  const all = await api<ApiFolder[]>('/api/folders');
  const folders = args.folder
    ? all.filter((f) => findFolder([f], args.folder!) !== undefined)
    : all.filter((f) => !isArchiveFolder(f.title));
  if (folders.length === 0) throw new Error('No matching folders');
  const cache = new Map<string, boolean>();
  const missingIds = new Set<string>();
  for (const f of folders) {
    console.log(`\n${f.title}`);
    for (const b of f.banks) {
      if (isSuperseded(b.title)) continue;
      if (!cache.has(b.id)) cache.set(b.id, (await getStudyAudioState(b.id)).hasAudio);
      const has = cache.get(b.id)!;
      if (!has) missingIds.add(b.id);
      const local = readLocal(args.out, b);
      const note = local ? (local.status === 'ok' ? '  [local preview ready]' : '  [local preview NEEDS REVIEW]') : '';
      console.log(`  ${has ? 'audio  ' : 'MISSING'}  ${b.id}  ${b.title}${note}`);
    }
  }
  const per = args.style === 'dialogue' ? estimateDialogueCost(args.minutes) : null;
  console.log(`\n${missingIds.size} unique bank${missingIds.size === 1 ? '' : 's'} without audio.`);
  if (per) {
    const total = per.gbp * missingIds.size;
    console.log(
      `Dialogue (Jess and Zac) estimate: ~${per.pence.toFixed(1)}p per ${args.minutes} minute episode, ~${(total * 100).toFixed(0)}p to fill every gap.`
    );
  } else {
    console.log('Narrator style costs well under 1p per bank.');
  }
  console.log('Generate (local preview only): npx tsx scripts/generate-bank-episodes.ts --folder "<folder title>"');
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
  if (args.upload && !r2) throw new Error('--upload needs R2 credentials (R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
  const { getStudyAudioState, uploadStudyAudio } = await import('../lib/r2');

  type Plan = {
    bank: ApiBank;
    hash: string;
    action: BankAction;
    chars: number;
    pence: number;
    narrator?: ReturnType<typeof buildEpisodeScript>;
    dialogue?: ReturnType<typeof buildDialogueSource>;
  };
  const plans: Plan[] = [];

  for (const id of bankIds) {
    const bank = await api<ApiBank>(`/api/banks/${id}`);
    if (bank.questions.length === 0) {
      console.log(`SKIP  ${bank.title}: no questions`);
      continue;
    }
    let hash: string;
    let chars: number;
    let pence: number;
    let narrator: Plan['narrator'];
    let dialogue: Plan['dialogue'];
    if (args.style === 'dialogue') {
      dialogue = buildDialogueSource(bank.questions);
      hash = dialogueSourceHash(dialogue.source, args.minutes);
      const est = estimateDialogueCost(args.minutes);
      chars = est.characters;
      pence = est.pence;
    } else {
      narrator = buildEpisodeScript(bank.title, bank.questions, { pauseSeconds: args.pause });
      hash = episodeSourceHash(narrator, args.voice);
      chars = narrator.characters;
      pence = estimateCost(chars).pence;
    }
    const remote = r2 ? await getStudyAudioState<EpisodeMeta>(id) : { hasAudio: false, meta: null };
    const action = decideBankAction({ remote, local: readLocal(args.out, bank), hash, force: args.force, upload: args.upload });
    plans.push({ bank, hash, action, chars, pence, narrator, dialogue });
  }

  const spends = (a: BankAction) => a === 'generate' || a === 'regenerate';
  let totalGbp = 0;
  console.log(`\nStyle: ${args.style}${args.style === 'dialogue' ? ' (Jess and Zac, Orpheus)' : ' (Kokoro narrator)'}`);
  for (const p of plans) {
    if (spends(p.action)) totalGbp += p.pence / 100;
    console.log(
      `${p.action.toUpperCase().padEnd(18)} ${p.bank.title} (${p.bank.questions.length}q, ~${p.pence.toFixed(2)}p${spends(p.action) ? '' : ', no spend'})`
    );
    if (p.action === 'skip-unmanaged') console.log('   an episode exists that this tool did not create; use --force to replace it');
    if (p.action === 'skip-needs-review') console.log(`   see ${localPaths(args.out, p.bank).review}`);
  }
  console.log(`\nTo generate: estimated ~${(totalGbp * 100).toFixed(1)}p. Cap: ${args.maxGbp.toFixed(2)} GBP. Upload: ${args.upload ? 'YES (--upload)' : 'no (local preview only)'}.`);

  if (totalGbp > args.maxGbp) {
    throw new Error(`Estimate ${totalGbp.toFixed(2)} GBP exceeds --max-gbp ${args.maxGbp.toFixed(2)}. Aborting.`);
  }
  if (args.dryRun) {
    console.log('Dry run, nothing generated or uploaded.');
    return;
  }

  await mkdir(args.out, { recursive: true });
  const needsReview: string[] = [];
  let generated = 0;

  for (const p of plans) {
    const paths = localPaths(args.out, p.bank);
    let status: 'ok' | 'needs-review' = 'ok';

    if (spends(p.action)) {
      console.log(`\nGenerating ${p.bank.title} ...`);
      let mp3: Buffer;
      let transcript: string;
      if (p.dialogue) {
        ({ mp3, transcript } = await renderDialogue(p.bank, p.dialogue.source, args.minutes));
        await writeFile(paths.notes, p.dialogue.notes);
        const check = checkDialogueTranscript(transcript, p.dialogue.notes, p.bank.questions.length);
        if (!check.ok) {
          status = 'needs-review';
          const lines = ['NEEDS REVIEW: not uploaded.', ''];
          if (check.bannedNames.length) lines.push(`Banned names or branding in transcript: ${check.bannedNames.join(', ')}`);
          if (check.unsupportedNumbers.length) lines.push(`Numbers in transcript that are not in the notes: ${check.unsupportedNumbers.join(', ')}`);
          await writeFile(paths.review, lines.join('\n') + '\n');
          console.log(`  NEEDS REVIEW: ${lines.slice(2).join(' | ')}`);
        }
        if (check.hasDashes) console.log('  warning: transcript contains em or en dashes');
      } else {
        mp3 = await renderEpisode(p.narrator!.segments, args.voice);
        transcript = p.narrator!.transcript;
      }
      await writeFile(paths.mp3, mp3);
      await writeFile(paths.transcript, transcript);
      await writeFile(paths.meta, JSON.stringify({ sourceHash: p.hash, status, style: args.style, generatedAt: new Date().toISOString() }));
      generated++;
      console.log(`  saved ${paths.mp3}`);
    } else if (p.action === 'skip-local-ready' || p.action === 'upload-local') {
      console.log(`\nLocal preview ready for ${p.bank.title}: ${paths.mp3}`);
    }

    if (status === 'needs-review') {
      needsReview.push(p.bank.title);
      continue;
    }
    if (args.upload && (spends(p.action) || p.action === 'upload-local')) {
      const mp3 = await readFile(paths.mp3);
      const transcript = await readFile(paths.transcript, 'utf8');
      const meta: EpisodeMeta = {
        sourceHash: p.hash,
        style: args.style,
        voice: args.style === 'dialogue' ? DIALOGUE_VOICES : args.voice,
        model: args.style === 'dialogue' ? DIALOGUE_TTS_MODEL : TTS_MODEL,
        characters: p.chars,
        questionCount: p.bank.questions.length,
        generatedAt: new Date().toISOString(),
      };
      const { audioUrl } = await uploadStudyAudio(p.bank.id, mp3, transcript, meta);
      console.log(`  uploaded ${(mp3.length / 1024 / 1024).toFixed(1)} MB: ${audioUrl}`);
    }
  }

  console.log(`\nDone. Generated ${generated}. Files in ${args.out}.`);
  if (needsReview.length) {
    console.log(`NEEDS REVIEW (not uploaded): ${needsReview.join('; ')}`);
    process.exitCode = 2;
  }
  if (!args.upload) console.log('Nothing uploaded. Listen first, then re-run the same command with --upload to publish passing banks (no regeneration).');
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
