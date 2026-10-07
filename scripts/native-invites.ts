#!/usr/bin/env npx tsx
/**
 * Native account invites (single use, hashed at rest, expiring).
 *
 *   npx tsx scripts/native-invites.ts create --target preview --env-file <file> [--count 3] [--expires-days 14] [--note "TestFlight A"]
 *   npx tsx scripts/native-invites.ts create ... --execute      # actually create (dry run otherwise)
 *   npx tsx scripts/native-invites.ts list   --target preview --env-file <file>
 *
 * `create` prints each code ONCE; only its hash is stored and hashes are never printed. Production needs --confirm.
 */
import { PrismaClient } from '@prisma/client';
import { generateInviteCode, hashCode } from '../lib/native/codes';
import { loadExplicitEnvFile, printTarget, resolveScriptTarget, TargetError } from './lib/target';

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (command !== 'create' && command !== 'list') {
    console.error('Usage: native-invites.ts <create|list> --target <local|preview|production> --env-file <file> ...');
    process.exit(2);
  }
  Object.assign(process.env, loadExplicitEnvFile(argv));
  let dryRun = false;
  try {
    const resolved = resolveScriptTarget({ argv, env: process.env, uses: { db: true }, mutating: command === 'create', destructive: command === 'create' });
    printTarget(`Native invites: ${command}`, resolved);
    dryRun = resolved.dryRun;
  } catch (e) {
    if (e instanceof TargetError) {
      console.error(`Refused: ${e.message}`);
      process.exit(3);
    }
    throw e;
  }

  const prisma = new PrismaClient();
  try {
    if (command === 'list') {
      const rows = await prisma.nativeInvite.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
      const now = new Date();
      for (const r of rows) {
        const state = r.usedAt ? 'used' : r.expiresAt <= now ? 'expired' : 'open';
        console.log(`${r.id}  ${state.padEnd(7)} created=${r.createdAt.toISOString()} expires=${r.expiresAt.toISOString()}${r.note ? `  note=${r.note}` : ''}`);
      }
      if (rows.length === 0) console.log('(no invites)');
      return;
    }
    const count = Math.min(Math.max(Number(flag(argv, '--count') ?? '1'), 1), 50);
    const days = Math.min(Math.max(Number(flag(argv, '--expires-days') ?? '14'), 1), 90);
    const note = flag(argv, '--note')?.slice(0, 120) ?? null;
    console.log(`Would create ${count} invite(s) expiring in ${days} days${note ? ` (note: ${note})` : ''}.`);
    if (dryRun) return console.log('Dry run: nothing created. Pass --execute.');
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    console.log('\nCopy these now; they are shown once and cannot be recovered:\n');
    for (let i = 0; i < count; i++) {
      const code = generateInviteCode();
      await prisma.nativeInvite.create({ data: { codeHash: hashCode(code), expiresAt, note } });
      console.log(`  ${code}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
