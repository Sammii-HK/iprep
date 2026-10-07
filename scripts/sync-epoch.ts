#!/usr/bin/env npx tsx
/**
 * Show or bump the sync epoch. Bump it after a database restore (transaction ids rewind, so every client must pull
 * again from the start; pulls are idempotent, so this is safe and cheap). Needs a connection that can UPDATE
 * SyncEpoch: use the owner env file.
 *
 *   npx tsx scripts/sync-epoch.ts show --target preview --env-file ~/.config/iprep/preview-migrate.env
 *   npx tsx scripts/sync-epoch.ts bump --target preview --env-file <owner env> [--execute] [--confirm <endpoint>]
 */
import { PrismaClient } from '@prisma/client';
import { loadExplicitEnvFile, printTarget, resolveScriptTarget, TargetError } from './lib/target';

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (command !== 'show' && command !== 'bump') {
    console.error('Usage: sync-epoch.ts <show|bump> --target <t> --env-file <owner env file> [--execute]');
    process.exit(2);
  }
  const fileEnv = loadExplicitEnvFile(argv);
  const url = fileEnv.DATABASE_MIGRATION_URL ?? fileEnv.DATABASE_URL;
  if (!url) {
    console.error('Refused: the env file must hold DATABASE_MIGRATION_URL or DATABASE_URL.');
    process.exit(3);
  }
  let dryRun = false;
  try {
    const resolved = resolveScriptTarget({ argv, env: { ...process.env, DATABASE_URL: url }, uses: { db: true }, mutating: command === 'bump', destructive: command === 'bump' });
    printTarget(`Sync epoch: ${command}`, resolved);
    dryRun = resolved.dryRun;
  } catch (e) {
    if (e instanceof TargetError) {
      console.error(`Refused: ${e.message}`);
      process.exit(3);
    }
    throw e;
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const row = await prisma.syncEpoch.findUnique({ where: { id: 1 } });
    console.log(`Current epoch: ${row?.epoch ?? '(missing)'}`);
    if (command === 'show') return;
    if (dryRun) return console.log(`Dry run: would set the epoch to ${(row?.epoch ?? 0) + 1}. Pass --execute.`);
    const next = await prisma.syncEpoch.upsert({ where: { id: 1 }, update: { epoch: { increment: 1 } }, create: { id: 1, epoch: 2 } });
    console.log(`Epoch is now ${next.epoch}. Every client will re-pull from the start on its next sync.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
