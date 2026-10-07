#!/usr/bin/env npx tsx
/**
 * Guarded account purge (owner credential). Removes the personal data of accounts whose 30-day deletion grace period
 * has ended. See lib/native/purge.ts and docs/P2_NATIVE_SYNC.md. NEVER run against real users without approval.
 *
 *   npx tsx scripts/purge-accounts.ts list  --target preview --env-file ~/.config/iprep/preview-migrate.env
 *   npx tsx scripts/purge-accounts.ts purge --target preview --env-file <migrate env> --due [--execute] [--confirm <endpoint>]
 *   npx tsx scripts/purge-accounts.ts purge ... --user <id> [--execute]
 *   ... --delete-audio --r2-env-file <file>     # also delete the R2 audio objects (otherwise the keys are listed)
 *
 * Uses DATABASE_MIGRATION_URL (the owner connection), never the runtime URL. Dry run unless --execute.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'dotenv';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { dueForPurge, purgeAccount } from '../lib/native/purge';
import { loadExplicitEnvFile, printTarget, resolveScriptTarget, TargetError } from './lib/target';

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (command !== 'list' && command !== 'purge') {
    console.error('Usage: purge-accounts.ts <list|purge> --target <t> --env-file <owner env file> ...');
    process.exit(2);
  }
  const fileEnv = loadExplicitEnvFile(argv);
  if (!fileEnv.DATABASE_MIGRATION_URL) {
    console.error('Refused: the env file must hold DATABASE_MIGRATION_URL (the owner connection).');
    process.exit(3);
  }
  const env = { ...process.env, DATABASE_URL: fileEnv.DATABASE_MIGRATION_URL };
  let dryRun = false;
  try {
    const resolved = resolveScriptTarget({ argv, env, uses: { db: true }, mutating: command === 'purge', destructive: command === 'purge' });
    printTarget(`Account purge: ${command}`, resolved);
    dryRun = resolved.dryRun;
  } catch (e) {
    if (e instanceof TargetError) {
      console.error(`Refused: ${e.message}`);
      process.exit(3);
    }
    throw e;
  }

  const prisma = new PrismaClient({ datasources: { db: { url: fileEnv.DATABASE_MIGRATION_URL } } });
  try {
    if (command === 'list') {
      const rows = await prisma.user.findMany({
        where: { deletionRequestedAt: { not: null } },
        select: { id: true, deletionRequestedAt: true, purgeAfter: true },
        orderBy: { purgeAfter: 'asc' },
      });
      const now = new Date();
      for (const r of rows) console.log(`${r.id}  requested=${r.deletionRequestedAt!.toISOString()}  purgeAfter=${r.purgeAfter!.toISOString()}  ${r.purgeAfter! <= now ? 'DUE' : 'in grace period'}`);
      if (rows.length === 0) console.log('(no accounts pending deletion)');
      return;
    }

    const userFlag = flag(argv, '--user');
    const ids = userFlag ? [userFlag] : argv.includes('--due') ? await dueForPurge(prisma) : [];
    if (ids.length === 0) return console.log('Nothing to purge. Pass --due or --user <id>.');
    console.log(`${ids.length} account(s) ${dryRun ? 'would be' : 'will be'} purged.`);
    if (dryRun) return console.log('Dry run: nothing deleted. Pass --execute.');

    let s3: S3Client | null = null;
    let bucket = '';
    if (argv.includes('--delete-audio')) {
      const r2 = parse(readFileSync(resolve(flag(argv, '--r2-env-file') ?? '')));
      bucket = r2.R2_BUCKET_NAME;
      s3 = new S3Client({ region: 'auto', endpoint: r2.R2_ENDPOINT, credentials: { accessKeyId: r2.R2_ACCESS_KEY_ID, secretAccessKey: r2.R2_SECRET_ACCESS_KEY }, forcePathStyle: true });
    }
    for (const id of ids) {
      const out = await purgeAccount(prisma, id);
      console.log(`purged ${id}: ${JSON.stringify(out.counts)}`);
      if (out.audioKeys.length > 0) {
        if (s3) {
          for (const key of out.audioKeys) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
          console.log(`  deleted ${out.audioKeys.length} audio object(s) from R2`);
        } else {
          console.log(`  MANUAL: ${out.audioKeys.length} audio object(s) in R2 still hold this learner's voice. Re-run with --delete-audio --r2-env-file, or delete these keys:`);
          for (const key of out.audioKeys) console.log(`    ${key}`);
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
