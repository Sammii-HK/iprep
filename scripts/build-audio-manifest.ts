#!/usr/bin/env npx tsx
// ============================================================
// Build the podcast manifest the iPrep iOS app reads.
//
//   npx tsx scripts/build-audio-manifest.ts [--out <path>] [--upload]
//
// Options:
//   --out <path>   Where to write manifest.json (default ./manifest.json)
//   --upload       Also upload it to R2 as audio/study/manifest.json (writes to production storage)
//
// Rules:
//   - Folders whose title starts "Archive:" and banks whose title starts "OLD" are left out.
//   - Only banks that have an episode are listed (checked on R2 when credentials exist,
//     otherwise through the auth-free GET /api/banks/<id>/audio route).
//   - A bank appears under its first non-role folder AND under every role folder
//     (titles ending "Interview Prep") it belongs to, so role playlists stay complete.
//   - Legacy static episodes are included only if they are generic (see LEGACY_GENERAL).
//   - Reads folders through the iPrep API (IPREP_BASE_URL + x-internal-key). The key is never printed.
// ============================================================

import { config } from 'dotenv';
import { writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { api, apiConfig } from './lib/iprep-api';

for (const dir of [process.cwd(), resolve(process.cwd(), '..', 'iprep')]) {
  config({ path: join(dir, '.env.production.local'), quiet: true });
  config({ path: join(dir, '.env.local'), quiet: true });
}

/** Where the app downloads episodes from. */
const AUDIO_BASE = (process.env.AUDIO_PUBLIC_BASE || 'https://iprep.sammii.dev').replace(/\/$/, '');
/** Public, auth-free deployment used for the legacy static files and for the audio check. */
const PUBLIC_API_BASE = 'https://iprep-five.vercel.app';

/**
 * Legacy static episodes that are not tied to a rejected or old application.
 * Left out on purpose: WunderGraph, n8n, StackOne (rejected), Ashby, Cloudflare, Found By Few (old applications).
 */
const LEGACY_GENERAL: Array<{ id: string; title: string }> = [
  { id: 'take-home-assignment-prep', title: 'Take-Home Assignment Prep' },
  { id: 'frontend-system-design', title: 'Frontend System Design' },
  { id: 'design-engineer-technical', title: 'Design Engineer: Technical' },
  { id: 'design-engineer-behavioral', title: 'Design Engineer: Behavioural' },
  { id: 'design-token-architecture', title: 'Design Token Architecture' },
  { id: 'javascript-deep-dive', title: 'JavaScript Deep Dive' },
  { id: 'performance-core-web-vitals', title: 'Performance and Core Web Vitals' },
  { id: 'accessibility-wcag', title: 'Accessibility and WCAG' },
  { id: 'star-stories', title: 'STAR Stories' },
];

interface ApiFolder {
  id: string;
  title: string;
  order: number;
  banks: Array<{ id: string; title: string }>;
}

interface ManifestEpisode {
  bankId: string;
  title: string;
  url: string;
  bytes: number;
}

interface ManifestFolder {
  title: string;
  order: number;
  episodes: ManifestEpisode[];
}

const isArchiveFolder = (title: string) => /^Archive:/i.test(title);
const isOldBank = (title: string) => /^OLD\b/.test(title);
const isRoleFolder = (title: string) => /Interview Prep$/i.test(title);

function hasR2(): boolean {
  return Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_BUCKET_NAME &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY
  );
}

/** Size in bytes of a published file, or null if it is not reachable. */
async function headBytes(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) return null;
    const n = Number(res.headers.get('content-length'));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  let out = './manifest.json';
  let upload = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i];
    else if (argv[i] === '--upload') upload = true;
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  if (!out) throw new Error('--out needs a path');

  apiConfig(); // fail early with a clear message if credentials are missing
  const r2 = hasR2();
  const { getStudyAudioState } = r2 ? await import('../lib/r2') : { getStudyAudioState: null };
  console.log(r2 ? 'Checking episodes on R2.' : 'No R2 credentials: checking episodes through the public audio route.');

  const folders = (await api<ApiFolder[]>('/api/folders'))
    .filter((f) => !isArchiveFolder(f.title))
    .sort((a, b) => a.order - b.order);

  // bankId -> episode (or null when there is no audio), so each bank is checked once.
  const episodes = new Map<string, ManifestEpisode | null>();
  async function episodeFor(bank: { id: string; title: string }): Promise<ManifestEpisode | null> {
    if (episodes.has(bank.id)) return episodes.get(bank.id)!;
    const url = `${AUDIO_BASE}/audio/study/${bank.id}.mp3`;
    let has = false;
    let routeBytes = 0;
    if (getStudyAudioState) {
      has = (await getStudyAudioState(bank.id)).hasAudio;
    } else {
      const res = await fetch(`${PUBLIC_API_BASE}/api/banks/${bank.id}/audio`);
      if (res.ok) {
        const j = (await res.json()) as { hasAudio?: boolean; fileSizeBytes?: number };
        has = Boolean(j.hasAudio);
        routeBytes = j.fileSizeBytes ?? 0;
      }
    }
    let result: ManifestEpisode | null = null;
    if (has) {
      const bytes = (await headBytes(url)) ?? routeBytes;
      if (!bytes) console.warn(`  warning: ${bank.title} has audio but ${url} is not reachable yet`);
      result = { bankId: bank.id, title: bank.title, url, bytes };
    }
    episodes.set(bank.id, result);
    return result;
  }

  const out_folders = new Map<string, ManifestFolder>();
  const placed = new Set<string>(); // banks already listed under a non-role folder
  const add = (folder: ApiFolder, ep: ManifestEpisode) => {
    const entry = out_folders.get(folder.id) ?? { title: folder.title, order: folder.order, episodes: [] };
    if (!entry.episodes.some((e) => e.bankId === ep.bankId)) entry.episodes.push(ep);
    out_folders.set(folder.id, entry);
  };

  for (const folder of folders) {
    const role = isRoleFolder(folder.title);
    for (const bank of folder.banks) {
      if (isOldBank(bank.title)) continue;
      if (!role && placed.has(bank.id)) continue; // first non-role folder wins
      const ep = await episodeFor(bank);
      if (!ep) continue;
      add(folder, ep);
      if (!role) placed.add(bank.id);
    }
  }

  const result: ManifestFolder[] = [...out_folders.values()].sort((a, b) => a.order - b.order);

  const general: ManifestEpisode[] = [];
  for (const ep of LEGACY_GENERAL) {
    const bytes = await headBytes(`${PUBLIC_API_BASE}/audio/study/${ep.id}.mp3`);
    if (!bytes) {
      console.warn(`  skipping legacy episode ${ep.id}: not reachable`);
      continue;
    }
    general.push({ bankId: ep.id, title: ep.title, url: `${PUBLIC_API_BASE}/audio/study/${ep.id}.mp3`, bytes });
  }
  if (general.length > 0) {
    result.push({ title: 'General', order: (result.at(-1)?.order ?? 0) + 1, episodes: general });
  }

  const manifest = { generatedAt: new Date().toISOString(), folders: result };
  const json = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(out, json);

  const count = result.reduce((n, f) => n + f.episodes.length, 0);
  const totalBytes = result.reduce((n, f) => n + f.episodes.reduce((m, e) => m + e.bytes, 0), 0);
  for (const f of result) console.log(`  ${f.title}: ${f.episodes.length}`);
  console.log(`\nWrote ${out}: ${result.length} folders, ${count} episodes, ${(totalBytes / 1024 / 1024).toFixed(0)} MB if everything were downloaded.`);

  if (upload) {
    if (!r2) throw new Error('Missing R2 credentials (R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
    const { uploadStudyManifest } = await import('../lib/r2');
    const { manifestUrl } = await uploadStudyManifest(json);
    console.log(`Uploaded: ${manifestUrl}`);
  }
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
