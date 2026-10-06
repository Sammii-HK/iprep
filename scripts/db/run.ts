#!/usr/bin/env npx tsx
/**
 * Explicit, guarded database migrations.
 *
 *   npx tsx scripts/db/run.ts status --target preview
 *   npx tsx scripts/db/run.ts deploy --target preview
 *   npx tsx scripts/db/run.ts deploy --target production --confirm <production-endpoint-id>
 *   npx tsx scripts/db/run.ts dev    --target local --name add_thing      (prisma migrate dev, local only)
 *
 * Reads the migration connection from DATABASE_MIGRATION_URL (process environment or an
 * explicit --env-file). Never reads the runtime DATABASE_URL and never loads an env file
 * implicitly. See docs/DB_WORKFLOW.md.
 */
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { parse as parseDotenv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { GuardError, assertMigrationRole, flagValue, hashMigrations, planMigration, type Rehearsal } from './guard';

const ROOT = resolve(__dirname, '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'prisma', 'migrations');
const REHEARSALS_FILE = join(ROOT, '.db-rehearsals.json');
const SCHEMA = join(ROOT, 'prisma', 'schema.prisma');

function readMigrationFiles(): Array<{ name: string; content: string }> {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, content: readFileSync(join(MIGRATIONS_DIR, d.name, 'migration.sql'), 'utf8') }));
}

function readRehearsals(): Rehearsal[] {
  if (!existsSync(REHEARSALS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(REHEARSALS_FILE, 'utf8')) as Rehearsal[];
  } catch {
    return [];
  }
}

/** Run the Prisma CLI with ONLY the migration connection in its environment. */
function prisma(args: string[], migrationUrl: string): number {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'development', // required by Next's ProcessEnv typing; irrelevant to the Prisma CLI
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    DATABASE_URL: migrationUrl,
    DATABASE_MIGRATION_URL: migrationUrl,
  };
  const r = spawnSync('npx', ['prisma', ...args, '--schema', SCHEMA], { stdio: 'inherit', env, cwd: ROOT });
  return r.status ?? 1;
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (command !== 'status' && command !== 'deploy' && command !== 'dev') {
    console.error('Usage: run.ts <status|deploy|dev> --target <local|preview|production> [--confirm <endpoint>] [--env-file <path>]');
    process.exit(2);
  }

  const envFile = flagValue(argv, '--env-file');
  const fileEnv = envFile ? parseDotenv(readFileSync(resolve(envFile))) : undefined;

  const hash = hashMigrations(readMigrationFiles());
  const plan = planMigration({
    argv: command === 'status' ? [...argv, '--status'] : argv,
    env: process.env,
    fileEnv,
    migrationsHash: hash,
    rehearsals: readRehearsals(),
  });

  console.log(`Target:     ${plan.target}`);
  console.log(`Connection: ${plan.description}`);
  for (const n of plan.notes) console.log(`Note:       ${n}`);

  if (command === 'dev' && plan.target !== 'local') {
    throw new GuardError('`dev` (prisma migrate dev) is only allowed with --target local.');
  }

  // Identity check: the migration role must be able to create objects.
  const client = new PrismaClient({ datasources: { db: { url: plan.migrationUrl } } });
  try {
    const rows = await client.$queryRawUnsafe<Array<{ u: string; can: boolean }>>(
      `SELECT current_user AS u, has_schema_privilege(current_user, 'public', 'CREATE') AS can`
    );
    assertMigrationRole({ user: rows[0].u, canCreateInSchema: rows[0].can });
    console.log(`Role:       ${rows[0].u} (can create objects in public)`);
  } finally {
    await client.$disconnect();
  }

  console.log('\nMigration status:');
  const statusCode = prisma(['migrate', 'status'], plan.migrationUrl);
  // `migrate status` exits non-zero when migrations are pending; that is information, not failure.

  if (command === 'status' || plan.statusOnly) {
    process.exit(plan.statusOnly && command === 'deploy' ? 1 : 0);
  }

  if (command === 'dev') {
    const name = flagValue(argv, '--name');
    process.exit(prisma(['migrate', 'dev', ...(name ? ['--name', name] : []), ...(argv.includes('--create-only') ? ['--create-only'] : [])], plan.migrationUrl));
  }

  console.log('\nApplying migrations...');
  const code = prisma(['migrate', 'deploy'], plan.migrationUrl);
  if (code === 0 && plan.target === 'preview') {
    const receipts = readRehearsals();
    receipts.push({ hash, at: new Date().toISOString(), host: plan.description });
    writeFileSync(REHEARSALS_FILE, JSON.stringify(receipts.slice(-20), null, 2));
    console.log('Recorded Preview rehearsal for this set of migrations.');
  }
  void statusCode;
  process.exit(code);
}

main().catch((e) => {
  if (e instanceof GuardError) {
    console.error(`\nRefused: ${e.message}`);
    process.exit(3);
  }
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
