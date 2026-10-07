/** Shared setup for the P2 Postgres integration tests: a throwaway local database migrated with the real migrations. */
import { spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { classifyDbTarget } from '@/lib/db-targets';

export const ADMIN_URL = process.env.TEST_PG_ADMIN_URL;
const root = join(__dirname, '..', '..');

function withDb(url: string, user: string | null, pw: string | null, db: string): string {
  const u = new URL(url);
  if (user) u.username = user;
  if (pw) u.password = pw;
  u.pathname = `/${db}`;
  return u.toString();
}

export interface TestDb {
  /** The schema owner (migrations, purge, maintenance). */
  owner: PrismaClient;
  /** A restricted runtime role like iprep_app: DML only, no UPDATE/DELETE/TRUNCATE on ledger tables. */
  app: PrismaClient;
  ownerUrl: string;
  appUrl: string;
  name: string;
  teardown: () => Promise<void>;
}

/**
 * Run every `DO $$ ... iprep_app ... $$` privilege block from the migrations against the given role, exactly as
 * written, so a test fails if a migration forgets a grant (or a revoke) the real runtime role needs.
 */
export async function applyMigrationPrivileges(owner: PrismaClient, role: string): Promise<void> {
  const dir = join(root, 'prisma', 'migrations');
  for (const d of readdirSync(dir).sort()) {
    if (!statSync(join(dir, d)).isDirectory()) continue;
    const sql = readFileSync(join(dir, d, 'migration.sql'), 'utf8');
    for (const block of sql.match(/DO \$\$[\s\S]*?END \$\$;/g) ?? []) {
      if (block.includes('"iprep_app"') || block.includes('iprep_app')) await owner.$executeRawUnsafe(block.replace(/'iprep_app'/g, `'${role}'`).replace(/"iprep_app"/g, `"${role}"`));
    }
  }
}

export async function createTestDb(prefix: string): Promise<TestDb> {
  if (classifyDbTarget(ADMIN_URL) !== 'local') throw new Error('TEST_PG_ADMIN_URL must be a local database');
  const suffix = randomBytes(4).toString('hex');
  const name = `${prefix}_${suffix}`;
  const ownerRole = `${prefix}_o_${suffix}`;
  const appRole = `${prefix}_a_${suffix}`;
  const ownerPw = `o${randomBytes(6).toString('hex')}`;
  const appPw = `a${randomBytes(6).toString('hex')}`;
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  await admin.$executeRawUnsafe(`CREATE ROLE ${ownerRole} LOGIN PASSWORD '${ownerPw}' CREATEROLE`);
  await admin.$executeRawUnsafe(`CREATE DATABASE ${name} OWNER ${ownerRole}`);
  await admin.$executeRawUnsafe(`CREATE ROLE ${appRole} LOGIN PASSWORD '${appPw}' NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS`);
  const ownerUrl = withDb(ADMIN_URL!, ownerRole, ownerPw, name);
  const appUrl = withDb(ADMIN_URL!, appRole, appPw, name);

  const r = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', join(root, 'prisma', 'schema.prisma')], {
    env: { ...process.env, DATABASE_URL: ownerUrl, DATABASE_MIGRATION_URL: ownerUrl },
    encoding: 'utf8',
    cwd: root,
  });
  if (r.status !== 0) throw new Error(`migrate deploy failed: ${r.stdout}${r.stderr}`);

  const owner = new PrismaClient({ datasources: { db: { url: ownerUrl } }, transactionOptions: { maxWait: 20_000, timeout: 60_000 } });
  await owner.$executeRawUnsafe(`GRANT CONNECT ON DATABASE ${name} TO ${appRole}`);
  await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${appRole}`);
  await owner.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appRole}`);
  await owner.$executeRawUnsafe(`REVOKE ALL ON TABLE _prisma_migrations FROM ${appRole}`);
  // The privilege blocks of the real migrations, run for this role (they skip themselves where `iprep_app` is absent).
  await applyMigrationPrivileges(owner, appRole);
  const app = new PrismaClient({ datasources: { db: { url: appUrl } }, transactionOptions: { maxWait: 20_000, timeout: 60_000 } });

  return {
    owner,
    app,
    ownerUrl,
    appUrl,
    name,
    teardown: async () => {
      await app.$disconnect();
      await owner.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS ${appRole}`);
      await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS ${ownerRole}`);
      await admin.$disconnect();
    },
  };
}

/** A user with a learner (and optionally a web login shape) created through the owner connection. */
export async function makeUser(db: PrismaClient, id: string, opts: { email?: string } = {}) {
  await db.$executeRawUnsafe(`INSERT INTO "User" ("id","email","updatedAt") VALUES ($1,$2,now())`, id, opts.email ?? null);
  await db.$executeRawUnsafe(`INSERT INTO "Learner" ("id","userId") VALUES ($1,$2)`, `lrn-${id}`, id);
  return { userId: id, learnerId: `lrn-${id}` };
}

/** Split a SQL script into statements, keeping $$ ... $$ function bodies whole and dropping comment lines and BEGIN/COMMIT. */
export function splitSql(sql: string): string[] {
  const text = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const out: string[] = [];
  let cur = '';
  let inDollar = false;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('$$', i)) {
      inDollar = !inDollar;
      cur += '$$';
      i++;
      continue;
    }
    if (text[i] === ';' && !inDollar) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += text[i];
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((st) => st !== 'BEGIN' && st !== 'COMMIT');
}
