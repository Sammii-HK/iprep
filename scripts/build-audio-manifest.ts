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
// Rules (nothing is left out: every episode that exists is listed):
//   - Every bank in every folder with an episode is included, including "Archive:" folders and "OLD" banks.
//     An episode is checked on R2 when credentials exist, otherwise through the auth-free
//     GET /api/banks/<id>/audio route.
//   - Order: live role folders (titles ending "Interview Prep"), then the other folders in their
//     normal order, then a "Past roles" group (archive banks and legacy files by company,
//     plus "Superseded" for OLD banks in live folders), then "General" (generic legacy files).
//   - A bank appears under its first non-role folder AND under every role folder it belongs to.
//   - Legacy static files (public/audio/study) are listed once: where a numbered file and a bare file
//     are the same audio, the numbered one is kept.
//   - Sub-groups of "Past roles" are folders with "group": "Past roles", so the app can show them together.
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
/** Public R2 domain, where the restored legacy files live under audio/study/legacy/. */
const R2_PUBLIC_BASE = 'https://iprep.sammii.dev';

const PAST_ROLES = 'Past roles';
/** Past-role companies, in display order. `match` is tested against bank titles. */
const COMPANIES: Array<{ name: string; match: RegExp }> = [
  { name: 'WunderGraph', match: /^WunderGraph\b/i },
  { name: 'n8n', match: /^n8n\b/i },
  { name: 'StackOne', match: /^StackOne\b/i },
  { name: 'Ashby', match: /^Ashby\b/i },
  { name: 'Cloudflare', match: /^Cloudflare\b/i },
  { name: 'Found By Few', match: /^Found By Few\b/i },
];
const SUPERSEDED = 'Superseded';
const OTHER_ARCHIVED = 'Other archived';

/**
 * Legacy static episodes in public/audio/study (31 files, 22 distinct recordings).
 * Bare-named copies of numbered files (for example frontend-system-design.mp3 and
 * 04-frontend-system-design.mp3) are byte-identical and are left out; the numbered file is kept.
 * `folder` is the company, or 'General' for recordings that are not tied to one role.
 */
const LEGACY: Array<{ id: string; title: string; folder: string }> = [
  { id: '01-wundergraph-role-specific', title: 'WunderGraph: Role Specific', folder: 'WunderGraph' },
  { id: '08-graphql-federation-product', title: 'GraphQL Federation and Product', folder: 'WunderGraph' },
  { id: '10-ux-audit-methodology', title: 'UX Audit Methodology', folder: 'WunderGraph' },
  { id: 'wundergraph-interview', title: 'WunderGraph: Full Interview', folder: 'WunderGraph' },
  { id: 'n8n-interview', title: 'n8n: Interview', folder: 'n8n' },
  { id: 'n8n-behavioural', title: 'n8n: Behavioural', folder: 'n8n' },
  { id: 'n8n-design-challenge', title: 'n8n: Design Challenge', folder: 'n8n' },
  { id: 'n8n-design-systems', title: 'n8n: Design Systems', folder: 'n8n' },
  { id: 'n8n-company-specific', title: 'n8n: Company Specific', folder: 'n8n' },
  { id: 'stackone-interview', title: 'StackOne: Interview', folder: 'StackOne' },
  { id: 'ashby-interview', title: 'Ashby: Interview', folder: 'Ashby' },
  { id: 'cloudflare-interview', title: 'Cloudflare: Interview', folder: 'Cloudflare' },
  { id: 'found-by-few-interview', title: 'Found By Few: Interview', folder: 'Found By Few' },
  { id: 'take-home-assignment-prep', title: 'Take-Home Assignment Prep', folder: 'General' },
  { id: '02-design-engineer-technical', title: 'Design Engineer: Technical', folder: 'General' },
  { id: '03-design-engineer-behavioral', title: 'Design Engineer: Behavioural', folder: 'General' },
  { id: '04-frontend-system-design', title: 'Frontend System Design', folder: 'General' },
  { id: '05-star-stories', title: 'STAR Stories', folder: 'General' },
  { id: '06-javascript-deep-dive', title: 'JavaScript Deep Dive', folder: 'General' },
  { id: '07-design-token-architecture', title: 'Design Token Architecture', folder: 'General' },
  { id: '09-performance-core-web-vitals', title: 'Performance and Core Web Vitals', folder: 'General' },
  { id: '11-accessibility-wcag', title: 'Accessibility and WCAG', folder: 'General' },
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
  group?: string;
  episodes: ManifestEpisode[];
}

const isArchiveFolder = (title: string) => /^Archive:/i.test(title);
const isOldBank = (title: string) => /^OLD\b/.test(title);
const companyFor = (title: string) => COMPANIES.find((c) => c.match.test(title))?.name ?? OTHER_ARCHIVED;
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

  const folders = (await api<ApiFolder[]>('/api/folders')).sort((a, b) => a.order - b.order);
  const live = folders.filter((f) => !isArchiveFolder(f.title));
  const archive = folders.filter((f) => isArchiveFolder(f.title));

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

  const roleFolders = new Map<string, ManifestFolder>();
  const genericFolders = new Map<string, ManifestFolder>();
  /** Past-roles sub-folders by name. */
  const past = new Map<string, ManifestEpisode[]>();
  const general: ManifestEpisode[] = [];

  const push = (into: Map<string, ManifestFolder>, folder: ApiFolder, ep: ManifestEpisode) => {
    const entry = into.get(folder.id) ?? { title: folder.title, order: 0, episodes: [] };
    if (!entry.episodes.some((e) => e.bankId === ep.bankId)) entry.episodes.push(ep);
    into.set(folder.id, entry);
  };
  const pushPast = (name: string, ep: ManifestEpisode) => {
    const list = past.get(name) ?? [];
    if (!list.some((e) => e.bankId === ep.bankId)) list.push(ep);
    past.set(name, list);
  };

  const placed = new Set<string>(); // banks already listed once outside the role folders
  for (const folder of live) {
    const role = isRoleFolder(folder.title);
    for (const bank of folder.banks) {
      const ep = await episodeFor(bank);
      if (!ep) continue;
      if (isOldBank(bank.title)) {
        if (!placed.has(bank.id)) pushPast(SUPERSEDED, ep);
        placed.add(bank.id);
        continue;
      }
      if (role) {
        push(roleFolders, folder, ep);
      } else if (!placed.has(bank.id)) {
        push(genericFolders, folder, ep); // first non-role folder wins
        placed.add(bank.id);
      }
    }
  }
  for (const folder of archive) {
    for (const bank of folder.banks) {
      if (placed.has(bank.id)) continue; // already listed in a live folder
      const ep = await episodeFor(bank);
      if (!ep) continue;
      placed.add(bank.id);
      pushPast(isOldBank(bank.title) ? SUPERSEDED : companyFor(bank.title), ep);
    }
  }

  for (const legacy of LEGACY) {
    const url = `${R2_PUBLIC_BASE}/audio/study/legacy/${legacy.id}.mp3`;
    const bytes = await headBytes(url);
    if (!bytes) {
      console.warn(`  skipping legacy episode ${legacy.id}: not reachable`);
      continue;
    }
    const ep = { bankId: legacy.id, title: legacy.title, url, bytes };
    if (legacy.folder === 'General') general.push(ep);
    else pushPast(legacy.folder, ep);
  }

  const result: ManifestFolder[] = [];
  const add = (f: Omit<ManifestFolder, 'order'>) => {
    if (f.episodes.length > 0) result.push({ ...f, order: result.length });
  };
  for (const f of roleFolders.values()) add(f);
  for (const f of genericFolders.values()) add(f);
  const pastOrder = [...COMPANIES.map((c) => c.name), SUPERSEDED, OTHER_ARCHIVED];
  for (const name of pastOrder) add({ title: name, group: PAST_ROLES, episodes: past.get(name) ?? [] });
  add({ title: 'General', episodes: general });

  const manifest = { generatedAt: new Date().toISOString(), folders: result };
  const json = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(out, json);

  const count = result.reduce((n, f) => n + f.episodes.length, 0);
  const totalBytes = result.reduce((n, f) => n + f.episodes.reduce((m, e) => m + e.bytes, 0), 0);
  for (const f of result) console.log(`  ${f.group ? `${f.group} / ` : ''}${f.title}: ${f.episodes.length}`);
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
