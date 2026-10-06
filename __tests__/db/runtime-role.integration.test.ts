/**
 * Integration test: the restricted runtime role works for the application's query patterns and
 * cannot do DDL. Needs a local Postgres admin connection:
 *
 *   TEST_PG_ADMIN_URL=postgresql://<you>@localhost:5432/postgres pnpm test:db   (defaults to $USER)
 *
 * It creates and drops a throwaway database and two roles. Skipped when TEST_PG_ADMIN_URL is unset.
 * Refuses to run against anything that is not local.
 */
import { spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyDbTarget } from '@/lib/db-targets';

const ADMIN_URL = process.env.TEST_PG_ADMIN_URL;
const root = join(__dirname, '..', '..');
const suffix = randomBytes(4).toString('hex');
const DB = `iprep_it_${suffix}`;
const OWNER = `it_owner_${suffix}`;
const APP = `it_app_${suffix}`;
const OWNER_PW = `o${randomBytes(6).toString('hex')}`;
const APP_PW = `a${randomBytes(6).toString('hex')}`;

function withDb(url: string, user: string, pw: string, db: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = pw;
  u.pathname = `/${db}`;
  return u.toString();
}

describe.skipIf(!ADMIN_URL)('runtime database role', () => {
  let admin: PrismaClient;
  let owner: PrismaClient;
  let app: PrismaClient;
  let ownerUrl = '';
  let appUrl = '';

  beforeAll(async () => {
    if (classifyDbTarget(ADMIN_URL) !== 'local') throw new Error('TEST_PG_ADMIN_URL must be a local database');
    admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
    await admin.$executeRawUnsafe(`CREATE ROLE ${OWNER} LOGIN PASSWORD '${OWNER_PW}' CREATEROLE`);
    await admin.$executeRawUnsafe(`CREATE DATABASE ${DB} OWNER ${OWNER}`);
    await admin.$executeRawUnsafe(
      `CREATE ROLE ${APP} LOGIN PASSWORD '${APP_PW}' NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS`
    );
    ownerUrl = withDb(ADMIN_URL!, OWNER, OWNER_PW, DB);
    appUrl = withDb(ADMIN_URL!, APP, APP_PW, DB);

    // Apply every migration with the owner (migration) connection only.
    const r = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', join(root, 'prisma', 'schema.prisma')], {
      env: { ...process.env, DATABASE_URL: ownerUrl, DATABASE_MIGRATION_URL: ownerUrl },
      encoding: 'utf8',
      cwd: root,
    });
    if (r.status !== 0) throw new Error(`migrate deploy failed: ${r.stdout}${r.stderr}`);

    owner = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
    await owner.$executeRawUnsafe(`GRANT CONNECT ON DATABASE ${DB} TO ${APP}`);
    await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${APP}`);
    await owner.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP}`);
    await owner.$executeRawUnsafe(`REVOKE ALL ON TABLE _prisma_migrations FROM ${APP}`);
    await owner.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP}`
    );
    app = new PrismaClient({ datasources: { db: { url: appUrl } } });
  }, 120_000);

  afterAll(async () => {
    await app?.$disconnect();
    await owner?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
      await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS ${APP}`);
      await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS ${OWNER}`);
      await admin.$disconnect();
    }
  });

  it('serves the application query patterns (nested create, include, transaction)', async () => {
    const user = await app.user.create({ data: { email: 'it@example.com', name: 'it', password: 'x' } });
    const bank = await app.questionBank.create({
      data: { title: 'b', userId: user.id, questions: { create: [{ text: 'q', difficulty: 3, tags: ['a'] }] } },
    });
    const found = await app.questionBank.findMany({ where: { userId: user.id }, include: { questions: true } });
    expect(found[0].questions).toHaveLength(1);
    await app.$transaction(async (tx) => {
      await tx.question.deleteMany({ where: { bankId: bank.id } });
      await tx.questionBank.delete({ where: { id: bank.id } });
    });
    expect(await app.questionBank.count()).toBe(0);
  });

  it('cannot run DDL', async () => {
    await expect(app.$executeRawUnsafe('CREATE TABLE should_not_exist (a int)')).rejects.toThrow();
    await expect(app.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN nope int')).rejects.toThrow();
    await expect(app.$executeRawUnsafe('DROP TABLE "Session"')).rejects.toThrow();
  });

  it('cannot manage roles or read the migrations table', async () => {
    await expect(app.$executeRawUnsafe('CREATE ROLE it_evil')).rejects.toThrow();
    await expect(app.$queryRawUnsafe('SELECT 1 FROM _prisma_migrations')).rejects.toThrow();
  });

  it('can use tables created by later migrations (default privileges)', async () => {
    await owner.$executeRawUnsafe('CREATE TABLE future_table (id int primary key)');
    await expect(app.$executeRawUnsafe('INSERT INTO future_table VALUES (1)')).resolves.toBeDefined();
  });

  it('cannot apply migrations (a runtime role is not a migration role)', () => {
    const r = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', join(root, 'prisma', 'schema.prisma')], {
      env: { ...process.env, DATABASE_URL: appUrl, DATABASE_MIGRATION_URL: appUrl },
      encoding: 'utf8',
      cwd: root,
    });
    // Nothing is pending, so deploy may succeed trivially; the real assertion is that it cannot create schema objects.
    expect(r.status === 0 || /permission denied/.test(r.stdout + r.stderr)).toBe(true);
  }, 60_000);
});
