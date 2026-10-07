/**
 * Privilege audit for everything P2 added, run as the restricted runtime role (the migrations' own privilege blocks
 * are applied to it, exactly as written). Nothing here is broadened to make a test pass.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ADMIN_URL, type TestDb, createTestDb, makeUser } from './helpers';
import { purgeAccount } from '@/lib/native/purge';

const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] as const;

describe.skipIf(!ADMIN_URL)('runtime role privileges (real database)', () => {
  let t: TestDb;
  let app: PrismaClient;
  let owner: PrismaClient;
  let role = '';

  const granted = async (table: string): Promise<string[]> => {
    const out: string[] = [];
    for (const p of PRIVS) {
      const [r] = await owner.$queryRawUnsafe<Array<{ ok: boolean }>>(`SELECT has_table_privilege('${role}', '"${table}"', '${p}') AS ok`);
      if (r.ok) out.push(p);
    }
    return out;
  };

  beforeAll(async () => {
    t = await createTestDb('p2priv');
    app = t.app;
    owner = t.owner;
    role = new URL(t.appUrl).username;
  }, 180_000);
  afterAll(async () => {
    await t?.teardown();
  });

  it('the role has no elevated attributes and owns nothing', async () => {
    const [a] = await owner.$queryRawUnsafe<Array<Record<string, boolean>>>(
      `SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication, rolcanlogin FROM pg_roles WHERE rolname = '${role}'`
    );
    expect(a).toEqual({ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false, rolreplication: false, rolcanlogin: true });
    const [owned] = await owner.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = '${role}'`
    );
    expect(Number(owned.n)).toBe(0);
    const [fns] = await owner.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE r.rolname = '${role}' AND ns.nspname = 'public'`
    );
    expect(Number(fns.n)).toBe(0);
  });

  it('every P2 table grants exactly the minimum: append-only where it is a log, read-only where only the owner writes', async () => {
    const dml = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
    expect(await granted('AttemptEvidence')).toEqual(['SELECT', 'INSERT']);
    expect(await granted('QuestionRevision')).toEqual(['SELECT', 'INSERT']); // written by the trigger, removed only by the FK cascade
    expect(await granted('SyncChange')).toEqual(['SELECT', 'INSERT']);
    expect(await granted('SyncEventLog')).toEqual(['SELECT', 'INSERT']);
    expect(await granted('SyncEpoch')).toEqual(['SELECT']); // an operator bumps it
    expect(await granted('AccountDeletionReceipt')).toEqual(['SELECT']); // only the owner-level purge writes receipts
    // Mutable by design, and nothing more than the default data privileges (no TRUNCATE, REFERENCES or TRIGGER):
    for (const table of ['AuthIdentity', 'NativeInvite', 'AccountLinkCode', 'Device', 'NativeRefreshToken']) expect(await granted(table)).toEqual(dml);
    // P1 ledger unchanged:
    for (const table of ['Attempt', 'AttemptEvaluation', 'AttemptMeasurement']) expect(await granted(table)).toEqual(['SELECT', 'INSERT']);
    expect(await granted('_prisma_migrations')).toEqual([]);
  });

  it('no table anywhere grants the role TRUNCATE, REFERENCES or TRIGGER', async () => {
    const tables = await owner.$queryRawUnsafe<Array<{ tablename: string }>>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
    expect(tables.length).toBeGreaterThan(30);
    for (const { tablename } of tables) {
      const g = await granted(tablename);
      expect(g.filter((p) => ['TRUNCATE', 'REFERENCES', 'TRIGGER'].includes(p)), tablename).toEqual([]);
    }
  });

  it('the only sequence in the schema is the feed id, and the role may use it but not set it', async () => {
    const seqs = await owner.$queryRawUnsafe<Array<{ sequencename: string }>>(`SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'`);
    expect(seqs.map((s) => s.sequencename)).toEqual(['SyncChange_id_seq']);
    const [p] = await owner.$queryRawUnsafe<Array<Record<string, boolean>>>(
      `SELECT has_sequence_privilege('${role}', '"SyncChange_id_seq"', 'USAGE') AS usage_, has_sequence_privilege('${role}', '"SyncChange_id_seq"', 'SELECT') AS select_, has_sequence_privilege('${role}', '"SyncChange_id_seq"', 'UPDATE') AS update_`
    );
    expect(p).toEqual({ usage_: true, select_: true, update_: false });
    await expect(app.$queryRawUnsafe(`SELECT setval('"SyncChange_id_seq"', 1)`)).rejects.toThrow(/permission denied/);
  });

  it('the application can actually do its P2 work as this role (feed insert uses the sequence)', async () => {
    const u = await makeUser(owner, 'priv-user');
    await expect(app.syncChange.create({ data: { learnerId: u.learnerId, entityType: 'attempt', entityId: 'x' } })).resolves.toBeDefined();
    const bank = await app.questionBank.create({ data: { userId: u.userId, title: 'b', questions: { create: [{ text: 'q', tags: [], difficulty: 1 }] } }, include: { questions: true } });
    await app.question.update({ where: { id: bank.questions[0].id }, data: { text: 'q2' } }); // the revision trigger inserts as the invoker
    expect(await app.questionRevision.count({ where: { questionId: bank.questions[0].id } })).toBe(2);
    await app.question.delete({ where: { id: bank.questions[0].id } }); // the cascade removes revisions without the role holding DELETE
    expect(await app.questionRevision.count({ where: { questionId: bank.questions[0].id } })).toBe(0);
  });

  it('cannot change the schema or escape the triggers', async () => {
    const denied = [
      `CREATE TABLE should_not_exist (a int)`,
      `ALTER TABLE "Attempt" ADD COLUMN nope int`,
      `DROP TABLE "SyncChange"`,
      `ALTER TABLE "Attempt" DISABLE TRIGGER ALL`,
      `ALTER TABLE "AttemptEvidence" DISABLE TRIGGER "AttemptEvidence_append_only"`,
      `DROP TRIGGER "Attempt_append_only" ON "Attempt"`,
      `CREATE FUNCTION p2_evil() RETURNS int LANGUAGE sql AS 'SELECT 1'`,
      `CREATE OR REPLACE FUNCTION "attempt_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$`,
      `CREATE ROLE p2_evil_role`,
      `SET ROLE postgres`,
      `SET session_replication_role = replica`, // would bypass every trigger, needs superuser
      `CREATE EXTENSION IF NOT EXISTS pg_stat_statements`,
    ];
    for (const sql of denied) await expect(app.$executeRawUnsafe(sql), sql).rejects.toThrow();
  });

  it('GRANT and ALTER DEFAULT PRIVILEGES are accepted with a warning but change nothing: the role has no grant option and owns no objects', async () => {
    await app.$executeRawUnsafe(`GRANT ALL ON "Attempt" TO PUBLIC`);
    await app.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO PUBLIC`);
    await owner.$executeRawUnsafe(`CREATE ROLE p2_probe_role NOLOGIN`);
    try {
      const [a] = await owner.$queryRawUnsafe<Array<{ ok: boolean }>>(`SELECT has_table_privilege('p2_probe_role', '"Attempt"', 'SELECT') AS ok`);
      expect(a.ok).toBe(false); // PUBLIC did not gain access to the ledger
      await owner.$executeRawUnsafe(`CREATE TABLE p2_future_table (a int)`);
      const [b] = await owner.$queryRawUnsafe<Array<{ ok: boolean }>>(`SELECT has_table_privilege('p2_probe_role', 'p2_future_table', 'SELECT') AS ok`);
      expect(b.ok).toBe(false); // owner-created tables did not inherit a PUBLIC grant either
    } finally {
      await owner.$executeRawUnsafe(`DROP TABLE IF EXISTS p2_future_table`);
      await owner.$executeRawUnsafe(`DROP ROLE IF EXISTS p2_probe_role`);
    }
  });

  it('cannot edit or remove anything immutable, even by asking for maintenance mode', async () => {
    const u = await makeUser(owner, 'priv-ledger');
    await owner.$executeRawUnsafe(`INSERT INTO "Attempt" ("id","learnerId","surface","responseMode","promptSnapshot","source","occurredAt") VALUES ('att-priv','${u.learnerId}','WRITTEN_TO_SPOKEN','SPOKEN','p','t',now())`);
    for (const sql of [
      `UPDATE "Attempt" SET "promptSnapshot" = 'x'`,
      `DELETE FROM "Attempt"`,
      `TRUNCATE "Attempt" CASCADE`,
      `UPDATE "QuestionRevision" SET "text" = 'x'`,
      `DELETE FROM "SyncChange"`,
      `UPDATE "SyncChange" SET "entityId" = 'x'`,
      `DELETE FROM "SyncEventLog"`,
      `UPDATE "SyncEpoch" SET "epoch" = 99`,
      `INSERT INTO "AccountDeletionReceipt" ("id","requestedAt","counts") VALUES ('r', now(), '{}')`,
      `DELETE FROM "AccountDeletionReceipt"`,
    ]) await expect(app.$executeRawUnsafe(sql), sql).rejects.toThrow(/permission denied/);
    await expect(
      app.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL iprep.ledger_maintenance = 'on'`);
        await tx.$executeRawUnsafe(`DELETE FROM "Attempt"`);
      })
    ).rejects.toThrow(/permission denied/);
    expect(Number((await owner.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "Attempt" WHERE id = 'att-priv'`))[0].n)).toBe(1);
  });

  it('cannot purge: the owner-only procedure refuses this role, and trigger functions cannot be called directly to any effect', async () => {
    const u = await makeUser(owner, 'priv-purge');
    await owner.user.update({ where: { id: u.userId }, data: { deletionRequestedAt: new Date(), purgeAfter: new Date(Date.now() - 1000) } });
    await expect(purgeAccount(app, u.userId)).rejects.toMatchObject({ code: 'PURGE_NEEDS_OWNER' });
    expect(await owner.user.count({ where: { id: u.userId } })).toBe(1);
    await expect(app.$queryRawUnsafe(`SELECT "question_revision_sync"()`)).rejects.toThrow(/trigger/i);
    await expect(app.$queryRawUnsafe(`SELECT "attempt_append_only"()`)).rejects.toThrow(/trigger/i);
  });

  it('cannot read the migration history, other databases\' roles, or run server programs', async () => {
    await expect(app.$queryRawUnsafe(`SELECT 1 FROM _prisma_migrations`)).rejects.toThrow(/permission denied/);
    await expect(app.$executeRawUnsafe(`COPY "User" TO PROGRAM 'echo hi'`)).rejects.toThrow(/permission denied|must be/);
    await expect(app.$executeRawUnsafe(`COPY "User" TO '/tmp/p2-leak.csv'`)).rejects.toThrow(/permission denied|must be/);
  });
});
