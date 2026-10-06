#!/usr/bin/env npx tsx
// ============================================================
// One step for a new role: folder + linked banks + audio episodes.
//
//   npx tsx scripts/new-role-folder.ts --title "Acme Interview Prep" --role-bank <bankId> \
//       [--shared <bankId> ...] [--no-default-shared] [--no-audio] [--style narrator] [--upload] [--out <dir>] [--dry-run]
//
// 1. Creates the folder (or reuses one with the same title) with the role bank first,
//    then the shared banks (Design Systems, verified stories, real questions, interview communication by default).
// 2. Runs scripts/generate-bank-episodes.ts for the folder: Jess and Zac dialogue episodes by default,
//    written to a local preview folder. Nothing is uploaded unless you add --upload (idempotent, cost capped).
//
// The role bank itself is authored separately (iPrep UI import or the iPrep MCP create_bank tool).
// ============================================================

import { execFileSync } from 'child_process';
import { join } from 'path';
import { api } from './lib/iprep-api';

/** Shared banks every role folder links. Keep in sync with the user's rule for role folders. */
const DEFAULT_SHARED_BANKS: Array<{ id: string; title: string }> = [
  { id: 'cmnd6u4nx00010ad4v1hivdc8', title: 'Design Systems: Tokens & Architecture' },
  { id: 'cmnd6u5o4000h0ad4e176gshv', title: 'Design Systems: Nomenclature & Philosophy' },
  { id: 'cmusbneuq000hjq04bxjpovmi', title: 'My stories: verified facts only (Oct 2026)' },
  { id: 'cmusfrznk0001l204bfl20u3d', title: 'Stories addendum: ASOS and Orbit (Oct 2026)' },
  { id: 'cmusbnejl0003jq04dq3wizv9', title: 'Real questions I have been asked (Oct 2026)' },
  { id: 'cmhnumeh00034ju04k9cx26gy', title: '6 Interview Communication' },
];

function parse(argv: string[]) {
  const out = { title: '', roleBank: '', shared: [] as string[], defaults: true, audio: true, dryRun: false, passthrough: [] as string[] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title') out.title = argv[++i];
    else if (a === '--role-bank') out.roleBank = argv[++i];
    else if (a === '--shared') out.shared.push(argv[++i]);
    else if (a === '--no-default-shared') out.defaults = false;
    else if (a === '--no-audio') out.audio = false;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--upload') out.passthrough.push('--upload');
    else if (a === '--style' || a === '--out' || a === '--max-gbp' || a === '--duration') out.passthrough.push(a, argv[++i]);
    else throw new Error(`Unknown option ${a}`);
  }
  if (!out.title) throw new Error('--title is required');
  if (!out.roleBank) throw new Error('--role-bank <bankId> is required');
  return out;
}

async function main() {
  const args = parse(process.argv.slice(2));
  const bankIds = [...new Set([args.roleBank, ...(args.defaults ? DEFAULT_SHARED_BANKS.map((b) => b.id) : []), ...args.shared])];

  const folders = await api<Array<{ id: string; title: string }>>('/api/folders');
  const existing = folders.find((f) => f.title === args.title);

  let folderId: string;
  if (existing) {
    folderId = existing.id;
    console.log(`Folder already exists, reusing: ${existing.title} (${existing.id})`);
  } else if (args.dryRun) {
    console.log(`Would create folder "${args.title}" with ${bankIds.length} banks:`);
    bankIds.forEach((id) => console.log(`  ${id}`));
    folderId = args.title;
  } else {
    const created = await api<{ id: string }>('/api/folders', { title: args.title, bankIds });
    folderId = created.id;
    console.log(`Created folder "${args.title}" (${folderId}) with ${bankIds.length} banks.`);
  }

  if (!args.audio) return;
  const genArgs = ['tsx', join(__dirname, 'generate-bank-episodes.ts'), '--folder', folderId];
  genArgs.push(...args.passthrough);
  if (args.dryRun) genArgs.push('--dry-run');
  if (existing || !args.dryRun) execFileSync('npx', genArgs, { stdio: 'inherit' });
  else console.log('Dry run: audio estimate needs the folder to exist. Run generate-bank-episodes.ts --dry-run on the role bank id instead.');
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
