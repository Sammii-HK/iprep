/**
 * Integration test for the P1 learner + attempt ledger against a real local Postgres.
 *
 *   TEST_PG_ADMIN_URL=postgresql://<you>@localhost:5432/postgres pnpm test:db   (defaults to $USER)
 *
 * Builds a throwaway database at the pre-P1 schema, fills it with data shaped like Production (owned and unowned
 * sessions, a failed-analysis row, an old-format row), applies the P1 migration, then checks that history was
 * preserved without inventing anything, that the ledger's invariants hold at the database level, that the restricted
 * runtime role can use the new tables, and that the real practice route writes a canonical attempt.
 */
import { spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyDbTarget } from '@/lib/db-targets';
import { applyMigrationPrivileges, splitSql } from './helpers';
import { METRIC_DIMENSIONS, aiEvaluation, appendEvaluation, deliveryEvaluation, recordAttempt } from '@/lib/attempts';
import { persistPracticeAnswer } from '@/lib/attempt-compat';

const ADMIN_URL = process.env.TEST_PG_ADMIN_URL;
const root = join(__dirname, '..', '..');
const suffix = randomBytes(4).toString('hex');
const DB = `iprep_ledger_${suffix}`;
const OWNER = `lg_owner_${suffix}`;
const APP = `lg_app_${suffix}`;
const OWNER_PW = `o${randomBytes(6).toString('hex')}`;
const APP_PW = `a${randomBytes(6).toString('hex')}`;
const P1_DIR = readdirSync(join(root, 'prisma', 'migrations')).find((d) => d.endsWith('_p1_learner_attempt_ledger'))!;
// The schema as it was before P1 existed (the parent of the P1 merge), for the structural rollback comparison.
const PRE_P1_COMMIT = 'b41e5a7';

function withDb(url: string, user: string, pw: string, db: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = pw;
  u.pathname = `/${db}`;
  return u.toString();
}

function migrate(schemaDir: string, url: string) {
  const r = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', join(schemaDir, 'schema.prisma')], {
    env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url },
    encoding: 'utf8',
    cwd: root,
  });
  if (r.status !== 0) throw new Error(`migrate deploy failed: ${r.stdout}${r.stderr}`);
}

describe.skipIf(!ADMIN_URL)('learner and attempt ledger (P1)', () => {
  let admin: PrismaClient;
  let owner: PrismaClient;
  let app: PrismaClient;
  let ownerUrl = '';
  let appUrl = '';
  const tmp = mkdtempSync(join(tmpdir(), 'iprep-p1-'));

  const run = (sql: string, ...params: unknown[]) => owner.$executeRawUnsafe(sql, ...params);
  const rows = <T = Record<string, unknown>>(sql: string, ...params: unknown[]) => owner.$queryRawUnsafe<T[]>(sql, ...params);

  beforeAll(async () => {
    if (classifyDbTarget(ADMIN_URL) !== 'local') throw new Error('TEST_PG_ADMIN_URL must be a local database');
    admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
    await admin.$executeRawUnsafe(`CREATE ROLE ${OWNER} LOGIN PASSWORD '${OWNER_PW}' CREATEROLE`);
    await admin.$executeRawUnsafe(`CREATE DATABASE ${DB} OWNER ${OWNER}`);
    await admin.$executeRawUnsafe(`CREATE ROLE ${APP} LOGIN PASSWORD '${APP_PW}' NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS`);
    ownerUrl = withDb(ADMIN_URL!, OWNER, OWNER_PW, DB);
    appUrl = withDb(ADMIN_URL!, APP, APP_PW, DB);

    // 1. The schema as Production has it today: every migration except P1.
    cpSync(join(root, 'prisma'), join(tmp, 'prisma'), { recursive: true });
    // The database as Production was before P1: every migration older than P1.
    for (const d of readdirSync(join(tmp, 'prisma', 'migrations'))) {
      if (d >= P1_DIR && d !== 'migration_lock.toml') rmSync(join(tmp, 'prisma', 'migrations', d), { recursive: true });
    }
    migrate(join(tmp, 'prisma'), ownerUrl);

    owner = new PrismaClient({ datasources: { db: { url: ownerUrl } } });

    // 2. Production-shaped legacy data. Two users, one with a machine principal; an unowned session; a failed
    //    analysis stored as canned scores; an old-format row with no answerQuality; a row with a missing audio url.
    await run(`INSERT INTO "User" ("id","email","role","updatedAt","createdAt") VALUES
      ('u-admin','admin@example.com','ADMIN',now(),'2025-11-01'), ('u-two','two@example.com','USER',now(),'2026-01-01')`);
    await run(`INSERT INTO "MachinePrincipal" ("id","name","tokenHash","tokenPrefix","scopes","userId")
      VALUES ('mp-1','mcp-write','${'h'.repeat(64)}','ipm_abcd',ARRAY['sessions:write'],'u-admin')`);
    await run(`INSERT INTO "QuestionBank" ("id","userId","title","updatedAt") VALUES ('b1','u-admin','Bank',now())`);
    await run(`INSERT INTO "Question" ("id","bankId","text","tags","difficulty","type") VALUES
      ('q1','b1','Explain closures.',ARRAY['js','fundamentals'],3,'TECHNICAL'),
      ('q2','b1','Tell me about a time you led a team.',ARRAY['leadership'],3,'BEHAVIORAL')`);
    await run(`INSERT INTO "Session" ("id","userId","title","bankId","createdAt") VALUES
      ('s-owned','u-admin','Owned','b1','2026-02-01'), ('s-orphan',NULL,'Orphan','b1','2025-11-06')`);
    // normal, completely populated
    await run(`INSERT INTO "SessionItem" ("id","sessionId","questionId","audioUrl","transcript","words","wpm","fillerCount","fillerRate","longPauses",
        "confidenceScore","intonationScore","starScore","impactScore","clarityScore","technicalAccuracy","terminologyUsage","questionAnswered","answerQuality",
        "whatWasRight","whatWasWrong","betterWording","dontForget","aiFeedback","createdAt")
      VALUES ('si-ok','s-owned','q1','https://r2.example/ok','a closure keeps its scope',5,110,1,20,0,6,5,6,6,8,7,5,true,7.5,
        ARRAY['clear'],ARRAY[]::text[],ARRAY['add an example'],ARRAY['mention GC'],'Nice | Add an example','2026-02-01 10:00')`);
    // failed analysis: canned scores stored as if real, delivery scores valid
    await run(`INSERT INTO "SessionItem" ("id","sessionId","questionId","audioUrl","transcript","words","wpm","fillerCount","fillerRate","longPauses",
        "confidenceScore","intonationScore","starScore","impactScore","clarityScore","technicalAccuracy","terminologyUsage","questionAnswered","answerQuality",
        "whatWasRight","whatWasWrong","betterWording","dontForget","aiFeedback","createdAt")
      VALUES ('si-failed','s-owned','q2','https://r2.example/f','I led a team of eight on a migration',8,100,0,0,0,4,4,4,4,4,4,4,true,4,
        ARRAY['recorded'],ARRAY[]::text[],ARRAY['use STAR'],ARRAY[]::text[],'AI analysis temporarily unavailable | Your response was recorded','2026-02-01 10:05')`);
    // old format: no answerQuality, no technicalAccuracy, no questionAnswered
    await run(`INSERT INTO "SessionItem" ("id","sessionId","questionId","audioUrl","transcript","words","wpm","fillerCount","fillerRate","longPauses",
        "confidenceScore","intonationScore","starScore","impactScore","clarityScore","whatWasRight","whatWasWrong","betterWording","dontForget","aiFeedback","createdAt")
      VALUES ('si-old','s-owned','q1',NULL,'old style answer here ok',5,90,0,0,0,3,3,2,2,3,ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],'Expand your answer','2025-12-01')`);
    // an owned answer with no scores, no feedback and no delivery scores: it has evidence but nothing was evaluated
    await run(`INSERT INTO "SessionItem" ("id","sessionId","questionId","audioUrl","transcript","whatWasRight","whatWasWrong","betterWording","dontForget","createdAt")
      VALUES ('si-bare','s-owned','q1','https://r2.example/b','a bare answer with nothing evaluated',ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],'2025-12-02')`);
    // unowned session: nobody to attribute it to
    await run(`INSERT INTO "SessionItem" ("id","sessionId","questionId","audioUrl","transcript","words","wpm","fillerCount","fillerRate","longPauses",
        "confidenceScore","intonationScore","whatWasRight","whatWasWrong","betterWording","dontForget","createdAt")
      VALUES ('si-unowned','s-orphan','q1','https://r2.example/u','orphan answer here',3,80,0,0,0,3,3,ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],'2025-11-06')`);

    // 3. Apply P1 with the owner (migration) connection.
    migrate(join(root, 'prisma'), ownerUrl);

    // The application's runtime role, as in docs/DB_WORKFLOW.md, then the migration's privilege block for it.
    await owner.$executeRawUnsafe(`GRANT CONNECT ON DATABASE ${DB} TO ${APP}`);
    await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${APP}`);
    await owner.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP}`);
    await owner.$executeRawUnsafe(`REVOKE ALL ON TABLE _prisma_migrations FROM ${APP}`);
    await applyMigrationPrivileges(owner, APP);
    app = new PrismaClient({ datasources: { db: { url: appUrl } } });
  }, 180_000);

  afterAll(async () => {
    await app?.$disconnect();
    await owner?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
      await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS ${APP}`);
      await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS ${OWNER}`);
      await admin.$disconnect();
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------------------- historical data

  describe('historical migration', () => {
    it('gives every existing user exactly one learner, using the user\'s own created date', async () => {
      const learners = await rows<{ userId: string; createdAt: Date }>(`SELECT "userId","createdAt" FROM "Learner" ORDER BY "userId"`);
      expect(learners.map((l) => l.userId)).toEqual(['u-admin', 'u-two']);
      expect(learners[0].createdAt.toISOString().slice(0, 10)).toBe('2025-11-01');
    });

    it('binds machine principals to their user\'s learner, and no principal is a learner', async () => {
      const bound = await rows<{ learnerId: string; lu: string }>(
        `SELECT m."learnerId", l."userId" AS lu FROM "MachinePrincipal" m JOIN "Learner" l ON l."id" = m."learnerId"`
      );
      expect(bound).toEqual([{ learnerId: 'lrn_u-admin', lu: 'u-admin' }]);
      expect(await rows(`SELECT 1 FROM "Learner" WHERE "id" = 'mp-1' OR "userId" = 'mp-1'`)).toHaveLength(0);
    });

    it('imports every attributable answer as an attempt belonging to its session owner\'s learner', async () => {
      const a = await rows<{ id: string; learnerId: string; surface: string; responseMode: string; source: string; sessionId: string; questionId: string; promptSnapshot: string; goalId: string | null; actorPrincipalId: string | null }>(
        `SELECT "id","learnerId","surface","responseMode","source","sessionId","questionId","promptSnapshot","goalId","actorPrincipalId" FROM "Attempt" ORDER BY "id"`
      );
      expect(a.map((x) => x.id)).toEqual(['att_si-bare', 'att_si-failed', 'att_si-ok', 'att_si-old']);
      for (const x of a) {
        expect(x).toMatchObject({ learnerId: 'lrn_u-admin', surface: 'WRITTEN_TO_SPOKEN', responseMode: 'SPOKEN', source: 'legacy-backfill', sessionId: 's-owned' });
        expect(x.goalId).toBeNull(); // no goal is ever invented for historical data
        expect(x.actorPrincipalId).toBeNull();
      }
      expect(a.find((x) => x.id === 'att_si-ok')).toMatchObject({ questionId: 'q1', promptSnapshot: 'Explain closures.' });
    });

    it('leaves answers in unowned sessions unmigrated: they cannot be attributed to anyone', async () => {
      expect(await rows(`SELECT 1 FROM "Attempt" WHERE "legacyRef" = 'SessionItem:si-unowned'`)).toHaveLength(0);
      const link = await rows<{ id: string; attemptId: string | null }>(`SELECT "id","attemptId" FROM "SessionItem" ORDER BY "id"`);
      expect(link).toEqual([
        { id: 'si-bare', attemptId: 'att_si-bare' },
        { id: 'si-failed', attemptId: 'att_si-failed' },
        { id: 'si-ok', attemptId: 'att_si-ok' },
        { id: 'si-old', attemptId: 'att_si-old' },
        { id: 'si-unowned', attemptId: null },
      ]);
    });

    it('preserves the factual evidence exactly: transcript, audio reference and delivery metrics', async () => {
      const [e] = await rows<Record<string, unknown>>(`SELECT * FROM "AttemptEvidence" WHERE "attemptId" = 'att_si-ok'`);
      expect(e).toMatchObject({ transcript: 'a closure keeps its scope', audioRef: 'https://r2.example/ok', words: 5, wpm: 110, fillerCount: 1, fillerRate: 20, longPauses: 0 });
      expect(e.transcriber).toBeNull(); // unknown stays unknown
      expect(e.responseText).toBeNull();
    });

    it('keeps missing evidence missing: no audio reference is invented, and a missing score has no row', async () => {
      const [e] = await rows<{ audioRef: string | null }>(`SELECT "audioRef" FROM "AttemptEvidence" WHERE "attemptId" = 'att_si-old'`);
      expect(e.audioRef).toBeNull();
      const metrics = await rows<{ metric: string }>(
        `SELECT m."metric" FROM "AttemptMeasurement" m WHERE m."attemptId" = 'att_si-old' ORDER BY m."metric"`
      );
      // no answerQuality, no technicalAccuracy, no terminologyUsage: they were never recorded
      expect(metrics.map((m) => m.metric)).toEqual(['clarityScore', 'confidenceScore', 'impactScore', 'intonationScore', 'starScore']);
      const [ev] = await rows<{ questionAnswered: boolean | null }>(`SELECT "questionAnswered" FROM "AttemptEvaluation" WHERE "id" = 'evl_si-old'`);
      expect(ev.questionAnswered).toBeNull();
    });

    it('records historical evaluators honestly: unversioned, unknown model and provider, unknown time', async () => {
      const [ev] = await rows<Record<string, unknown>>(`SELECT * FROM "AttemptEvaluation" WHERE "id" = 'evl_si-ok'`);
      expect(ev).toMatchObject({ kind: 'LEGACY_IMPORT', status: 'COMPLETED', evaluatorVersion: 'legacy-unversioned', dimensionMap: 'dimensions@1' });
      expect(ev.rubricVersion).toBeNull();
      expect(ev.promptVersion).toBeNull();
      expect(ev.provider).toBeNull();
      expect(ev.model).toBeNull();
      expect(ev.evaluatedAt).toBeNull();
      expect(ev.recordedAt).toBeInstanceOf(Date);
      expect(ev.feedback).toMatchObject({ whatWasRight: ['clear'], betterWording: ['add an example'], dontForget: ['mention GC'], text: 'Nice | Add an example' });
    });

    it('applies the same dimension tagging as the application code', async () => {
      const m = await rows<{ metric: string; dimension: string | null; value: number }>(
        `SELECT "metric","dimension","value" FROM "AttemptMeasurement" WHERE "attemptId" = 'att_si-ok'`
      );
      expect(m).toHaveLength(8);
      for (const row of m) expect(row.dimension).toBe(METRIC_DIMENSIONS[row.metric]);
      expect(m.find((x) => x.metric === 'answerQuality')?.value).toBe(7.5);
    });

    it('records a stored fallback as evaluator failure metadata only: no scores, no canned feedback, no answered flag', async () => {
      const [ai] = await rows<{ status: string; failureReason: string; questionAnswered: boolean | null; feedback: unknown }>(
        `SELECT "status","failureReason","questionAnswered","feedback" FROM "AttemptEvaluation" WHERE "id" = 'evl_si-failed'`
      );
      expect(ai.status).toBe('FAILED');
      expect(ai.failureReason).toBe('legacy fallback stored as scores: AI analysis temporarily unavailable');
      expect(ai.questionAnswered).toBeNull(); // the fixture row says true: that was canned
      expect(ai.feedback).toBeNull(); // "Your response was recorded" is boilerplate, not feedback
      expect(await rows(`SELECT 1 FROM "AttemptMeasurement" WHERE "evaluationId" = 'evl_si-failed'`)).toHaveLength(0);
      // delivery heuristics are real measurements of the transcript and stay valid
      const delivery = await rows<{ metric: string; value: number }>(`SELECT "metric","value" FROM "AttemptMeasurement" WHERE "evaluationId" = 'evd_si-failed' ORDER BY "metric"`);
      expect(delivery).toEqual([{ metric: 'confidenceScore', value: 4 }, { metric: 'intonationScore', value: 4 }]);
    });

    it('audit: an evaluation exists only where the legacy row has the evidence for it, with exact counts by kind, status and dimension', async () => {
      // the bare row has evidence but nothing to evaluate: no evaluation of either kind
      expect(await rows(`SELECT 1 FROM "AttemptEvaluation" WHERE "attemptId" = 'att_si-bare'`)).toHaveLength(0);
      expect(await rows(`SELECT 1 FROM "AttemptEvidence" WHERE "attemptId" = 'att_si-bare'`)).toHaveLength(1);
      const byType = await rows<{ type: string; status: string; n: number }>(
        `SELECT CASE WHEN "legacyRef" LIKE '%:delivery' THEN 'delivery' ELSE 'content' END AS type, "status"::text AS status, count(*)::int AS n
         FROM "AttemptEvaluation" GROUP BY 1,2 ORDER BY 1,2`
      );
      expect(byType).toEqual([
        { type: 'content', status: 'COMPLETED', n: 2 },
        { type: 'content', status: 'FAILED', n: 1 },
        { type: 'delivery', status: 'COMPLETED', n: 3 },
      ]);
      const byDimension = await rows<{ d: string; n: number }>(
        `SELECT coalesce("dimension"::text,'(none)') AS d, count(*)::int AS n FROM "AttemptMeasurement" GROUP BY 1 ORDER BY 1`
      );
      // ok: 6 content + 2 delivery; old: 3 content (star, impact, clarity) + 2 delivery; failed: 0 content + 2 delivery
      expect(byDimension).toEqual([
        { d: '(none)', n: 6 }, // ok: answerQuality, star, impact, terminology (4) + old: star, impact (2)
        { d: 'DELIVERY', n: 6 },
        { d: 'EXPLANATION', n: 2 }, // ok + old clarityScore
        { d: 'RECALL', n: 1 }, // ok technicalAccuracy; old has none
      ]);
      // every measurement belongs to a COMPLETED evaluation, and none came from a fallback
      expect(await rows(`SELECT 1 FROM "AttemptMeasurement" m JOIN "AttemptEvaluation" e ON e."id" = m."evaluationId" WHERE e."status" <> 'COMPLETED'`)).toHaveLength(0);
    });

    it('does not touch the legacy rows: the UI keeps reading exactly what it read before', async () => {
      const [r] = await rows<{ answerQuality: number; aiFeedback: string; transcript: string }>(`SELECT "answerQuality","aiFeedback","transcript" FROM "SessionItem" WHERE "id" = 'si-failed'`);
      expect(r).toMatchObject({ answerQuality: 4, aiFeedback: 'AI analysis temporarily unavailable | Your response was recorded', transcript: 'I led a team of eight on a migration' });
    });

    it('the backfill is idempotent: running it again changes nothing', async () => {
      const sql = readFileSync(join(root, 'prisma', 'migrations', P1_DIR, 'migration.sql'), 'utf8');
      const backfill = sql.slice(sql.indexOf('-- Backfill.'), sql.indexOf('-- Privileges.'));
      const statements = backfill.split(/;\s*\n/).map((s) => s.replace(/^(\s*--.*\n)+/gm, '').trim()).filter(Boolean);
      const count = async () => Number((await rows<{ n: bigint }>(`SELECT (SELECT count(*) FROM "Attempt") + (SELECT count(*) FROM "AttemptEvidence") + (SELECT count(*) FROM "AttemptEvaluation") + (SELECT count(*) FROM "AttemptMeasurement") + (SELECT count(*) FROM "Learner") AS n`))[0].n);
      const before = await count();
      for (const s of statements) await run(s);
      expect(await count()).toBe(before);
    });
  });

  // ---------------------------------------------------------------------------------------- invariants

  describe('database invariants', () => {
    const learnerId = 'lrn_u-admin';
    const newAttempt = async (id: string, surface = 'WRITTEN_TO_SPOKEN', mode = 'SPOKEN') =>
      run(`INSERT INTO "Attempt" ("id","learnerId","surface","responseMode","promptSnapshot","source","occurredAt") VALUES ($1,$2,$3::"AttemptSurface",$4::"ResponseMode",'p','test',now())`, id, learnerId, surface, mode);
    const newEval = async (id: string, attemptId: string, status = 'COMPLETED') =>
      run(`INSERT INTO "AttemptEvaluation" ("id","attemptId","kind","status","evaluatorVersion","failureReason") VALUES ($1,$2,'AI_RUBRIC',$3::"EvaluationStatus",'t',$4)`, id, attemptId, status, status === 'FAILED' ? 'x' : null);

    it('the ledger is append-only: UPDATE and DELETE are refused, even for the schema owner', async () => {
      await expect(run(`UPDATE "AttemptEvidence" SET "transcript" = 'edited' WHERE "attemptId" = 'att_si-ok'`)).rejects.toThrow(/append-only/);
      await expect(run(`DELETE FROM "AttemptEvidence" WHERE "attemptId" = 'att_si-ok'`)).rejects.toThrow(/append-only/);
      await expect(run(`UPDATE "AttemptEvaluation" SET "status" = 'FAILED' WHERE "id" = 'evl_si-ok'`)).rejects.toThrow(/append-only/);
      await expect(run(`DELETE FROM "AttemptEvaluation" WHERE "id" = 'evl_si-ok'`)).rejects.toThrow(/append-only/);
      await expect(run(`UPDATE "AttemptMeasurement" SET "value" = 10 WHERE "attemptId" = 'att_si-ok'`)).rejects.toThrow(/append-only/);
      await expect(run(`DELETE FROM "AttemptMeasurement" WHERE "attemptId" = 'att_si-ok'`)).rejects.toThrow(/append-only/);
      await expect(run(`UPDATE "Attempt" SET "promptSnapshot" = 'edited' WHERE "id" = 'att_si-ok'`)).rejects.toThrow(/append-only/);
      await expect(run(`UPDATE "Attempt" SET "learnerId" = 'lrn_u-two' WHERE "id" = 'att_si-ok'`)).rejects.toThrow(/append-only/);
      await expect(run(`DELETE FROM "Attempt" WHERE "id" = 'att_si-ok'`)).rejects.toThrow(/append-only/);
    });

    it('a maintenance session can opt in explicitly, and only inside its own transaction', async () => {
      await newAttempt('att_maint');
      await owner.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL iprep.ledger_maintenance = 'on'`);
        await tx.$executeRawUnsafe(`DELETE FROM "Attempt" WHERE "id" = 'att_maint'`);
      });
      expect(await rows(`SELECT 1 FROM "Attempt" WHERE "id" = 'att_maint'`)).toHaveLength(0);
      await newAttempt('att_maint2');
      await expect(run(`DELETE FROM "Attempt" WHERE "id" = 'att_maint2'`)).rejects.toThrow(/append-only/);
    });

    it('an attempt outlives its question, its session and its bank: references are cleared, evidence stays', async () => {
      await run(`INSERT INTO "QuestionBank" ("id","userId","title","updatedAt") VALUES ('b-tmp','u-admin','Tmp',now())`);
      await run(`INSERT INTO "Question" ("id","bankId","text","tags","difficulty") VALUES ('q-tmp','b-tmp','Temporary question',ARRAY['t'],1)`);
      await run(`INSERT INTO "Session" ("id","userId","title","bankId") VALUES ('s-tmp','u-admin','Tmp session','b-tmp')`);
      await run(`INSERT INTO "Attempt" ("id","learnerId","surface","responseMode","questionId","promptSnapshot","bankId","sessionId","source","occurredAt")
        VALUES ('att_tmp',$1,'WRITTEN_TO_SPOKEN','SPOKEN','q-tmp','Temporary question','b-tmp','s-tmp','test',now())`, learnerId);
      await run(`INSERT INTO "AttemptEvidence" ("id","attemptId","transcript") VALUES ('evi_tmp','att_tmp','kept')`);
      await run(`DELETE FROM "Session" WHERE "id" = 's-tmp'`); // a session never owns its attempts
      await run(`DELETE FROM "Question" WHERE "id" = 'q-tmp'`);
      await run(`DELETE FROM "QuestionBank" WHERE "id" = 'b-tmp'`);
      const [a] = await rows<{ questionId: string | null; sessionId: string | null; bankId: string | null; promptSnapshot: string }>(
        `SELECT "questionId","sessionId","bankId","promptSnapshot" FROM "Attempt" WHERE "id" = 'att_tmp'`
      );
      expect(a).toEqual({ questionId: null, sessionId: null, bankId: null, promptSnapshot: 'Temporary question' });
      expect(await rows(`SELECT 1 FROM "AttemptEvidence" WHERE "attemptId" = 'att_tmp'`)).toHaveLength(1);
      // ...but a reference can only be cleared, never repointed
      await expect(run(`UPDATE "Attempt" SET "sessionId" = 's-owned' WHERE "id" = 'att_tmp'`)).rejects.toThrow(/append-only/);
    });

    it('deleting a legacy SessionItem leaves its attempt in the ledger', async () => {
      await run(`INSERT INTO "SessionItem" ("id","sessionId","questionId","attemptId","whatWasRight","whatWasWrong","betterWording","dontForget")
        VALUES ('si-del','s-owned','q1','att_tmp',ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[])`);
      await run(`DELETE FROM "SessionItem" WHERE "id" = 'si-del'`);
      expect(await rows(`SELECT 1 FROM "Attempt" WHERE "id" = 'att_tmp'`)).toHaveLength(1);
    });

    it('a user or learner with attempts cannot be deleted', async () => {
      await expect(run(`DELETE FROM "Learner" WHERE "id" = 'lrn_u-admin'`)).rejects.toThrow();
      await expect(run(`DELETE FROM "User" WHERE "id" = 'u-admin'`)).rejects.toThrow();
    });

    it('listening is exposure: a listen-only attempt has no response and only EXPOSURE measurements', async () => {
      await expect(newAttempt('att_bad_listen', 'PODCAST_LISTEN', 'SPOKEN')).rejects.toThrow(/Attempt_exposure_has_no_response_chk/);
      await expect(newAttempt('att_bad_retrieval', 'PODCAST_RETRIEVAL', 'NONE')).rejects.toThrow(/Attempt_exposure_has_no_response_chk/);
      await newAttempt('att_listen', 'PODCAST_LISTEN', 'NONE');
      await newEval('evl_listen', 'att_listen');
      const m = (dim: string | null, metric: string) =>
        run(`INSERT INTO "AttemptMeasurement" ("id","evaluationId","attemptId","dimension","metric","value","scaleMin","scaleMax") VALUES ($1,'evl_listen','att_listen',$2::"MeasurementDimension",$3,1,0,1)`, `m_${metric}`, dim, metric);
      await expect(m('RECALL', 'recalled')).rejects.toThrow(/listen-only attempt can only carry EXPOSURE/);
      await expect(m(null, 'untagged')).rejects.toThrow(/listen-only attempt can only carry EXPOSURE/);
      await m('EXPOSURE', 'listenedFraction');
      expect(await rows(`SELECT 1 FROM "AttemptMeasurement" WHERE "attemptId" = 'att_listen' AND "dimension" = 'RECALL'`)).toHaveLength(0);
    });

    it('a failed or skipped evaluation cannot carry measurements', async () => {
      await newAttempt('att_f');
      await newEval('evl_f', 'att_f', 'FAILED');
      await expect(
        run(`INSERT INTO "AttemptMeasurement" ("id","evaluationId","attemptId","metric","value") VALUES ('m_f','evl_f','att_f','answerQuality',4)`)
      ).rejects.toThrow(/COMPLETED evaluation/);
    });

    it('a measurement must belong to the attempt of its evaluation, and sit inside its scale', async () => {
      await newAttempt('att_m1');
      await newAttempt('att_m2');
      await newEval('evl_m1', 'att_m1');
      await expect(
        run(`INSERT INTO "AttemptMeasurement" ("id","evaluationId","attemptId","metric","value") VALUES ('m_x','evl_m1','att_m2','answerQuality',5)`)
      ).rejects.toThrow();
      await expect(
        run(`INSERT INTO "AttemptMeasurement" ("id","evaluationId","attemptId","metric","value") VALUES ('m_y','evl_m1','att_m1','answerQuality',11)`)
      ).rejects.toThrow(/value_in_scale/);
    });

    it('measurements are sparse: an attempt can carry just one dimension and nothing else exists', async () => {
      await newAttempt('att_sparse');
      await newEval('evl_sparse', 'att_sparse');
      await run(`INSERT INTO "AttemptMeasurement" ("id","evaluationId","attemptId","dimension","metric","value") VALUES ('m_sparse','evl_sparse','att_sparse','RECALL','technicalAccuracy',6)`);
      const m = await rows<{ dimension: string }>(`SELECT "dimension" FROM "AttemptMeasurement" WHERE "attemptId" = 'att_sparse'`);
      expect(m).toEqual([{ dimension: 'RECALL' }]);
    });
  });

  // ---------------------------------------------------------------------------------------- runtime role

  describe('the restricted runtime role', () => {
    it('records an attempt through the application code, with nested reads', async () => {
      const learner = await app.learner.upsert({ where: { userId: 'u-two' }, update: {}, create: { userId: 'u-two' }, select: { id: true } });
      const out = await app.$transaction((tx) =>
        recordAttempt(tx, {
          learnerId: learner.id,
          surface: 'TYPED_RETRIEVAL',
          responseMode: 'TYPED',
          source: 'test',
          prompt: { questionId: 'q1', text: 'Explain closures.', tags: ['js'], bankId: 'b1' },
          evidence: { responseText: 'a function plus its scope' },
          evaluations: [
            aiEvaluation({ outcome: { status: 'COMPLETED', questionAnswered: true, scores: { answerQuality: 8, technicalAccuracy: 9 }, feedback: { text: 'good' } }, provider: 'openai', model: 'gpt-4o-mini' }),
            deliveryEvaluation({ confidenceScore: 6, intonationScore: 5 })!,
          ],
        })
      );
      const read = await app.attempt.findUnique({
        where: { id: out.attemptId },
        include: { evidence: true, evaluations: { include: { measurements: true } }, learner: true },
      });
      expect(read?.learner.userId).toBe('u-two');
      expect(read?.evidence?.responseText).toBe('a function plus its scope');
      expect(read?.evaluations).toHaveLength(2);
      const ai = read?.evaluations.find((e) => e.kind === 'AI_RUBRIC');
      expect(ai).toMatchObject({ evaluatorVersion: 'spoken-answer@1', rubricVersion: 'spoken-answer-rubric@1', promptVersion: 'spoken-answer-prompt@1', model: 'gpt-4o-mini' });
      expect(ai?.measurements.map((m) => `${m.metric}:${m.dimension}`).sort()).toEqual(['answerQuality:null', 'technicalAccuracy:RECALL']);

      // re-evaluation appends: the original evaluation is untouched
      await app.$transaction((tx) =>
        appendEvaluation(tx, out.attemptId, [aiEvaluation({ outcome: { status: 'COMPLETED', questionAnswered: true, scores: { answerQuality: 6 }, feedback: {} }, provider: 'openai', model: 'gpt-4o-mini' })])
      );
      expect(await app.attemptEvaluation.count({ where: { attemptId: out.attemptId, kind: 'AI_RUBRIC' } })).toBe(2);
    });

    it('cannot rewrite or remove ledger rows, with or without the maintenance setting', async () => {
      await expect(app.$executeRawUnsafe(`UPDATE "AttemptEvidence" SET "transcript" = 'x'`)).rejects.toThrow(/permission denied/);
      await expect(app.$executeRawUnsafe(`DELETE FROM "AttemptMeasurement"`)).rejects.toThrow(/permission denied/);
      await expect(app.$executeRawUnsafe(`DELETE FROM "Attempt"`)).rejects.toThrow(/permission denied/);
      await expect(app.$executeRawUnsafe(`TRUNCATE "Attempt" CASCADE`)).rejects.toThrow(/permission denied/);
      await expect(
        app.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL iprep.ledger_maintenance = 'on'`);
          await tx.$executeRawUnsafe(`DELETE FROM "Attempt"`);
        })
      ).rejects.toThrow(/permission denied/);
    });

    it('still deletes questions, sessions and banks (foreign-key SET NULL runs as the owner, not the role)', async () => {
      const bank = await app.questionBank.create({ data: { title: 'rt', userId: 'u-two', questions: { create: [{ text: 'rt q', difficulty: 2, tags: [] }] } }, include: { questions: true } });
      const learner = await app.learner.findUniqueOrThrow({ where: { userId: 'u-two' } });
      const att = await app.$transaction((tx) =>
        recordAttempt(tx, { learnerId: learner.id, surface: 'TYPED_RETRIEVAL', responseMode: 'TYPED', source: 'test', prompt: { questionId: bank.questions[0].id, text: 'rt q', bankId: bank.id }, evaluations: [] })
      );
      await app.$transaction([app.question.deleteMany({ where: { bankId: bank.id } }), app.questionBank.delete({ where: { id: bank.id } })]);
      const kept = await app.attempt.findUniqueOrThrow({ where: { id: att.attemptId } });
      expect(kept).toMatchObject({ questionId: null, bankId: null, promptSnapshot: 'rt q' });
    });
  });

  // ---------------------------------------------------------------------------------------- the real flow

  describe('the existing written-prompt to spoken-answer flow', () => {
    it('writes a canonical attempt with evidence and evaluations alongside the legacy row', async () => {
      const session = await app.session.create({ data: { userId: 'u-two', title: 'Flow', bankId: null } });
      const bank = await app.questionBank.create({ data: { title: 'flow', userId: 'u-two', questions: { create: [{ text: 'Describe the virtual DOM.', difficulty: 3, tags: ['react'] }] } }, include: { questions: true } });
      const q = bank.questions[0];
      const out = await persistPracticeAnswer(
        app,
        {
          sessionId: session.id, questionId: q.id, audioUrl: 'https://r2.example/new', transcript: 'it diffs a tree', words: 4, wpm: 100, fillerCount: 0, fillerRate: 0, longPauses: 0,
          confidenceScore: 6, intonationScore: 5, answerQuality: 7, technicalAccuracy: 7, clarityScore: 6, starScore: 6, impactScore: 6, terminologyUsage: 6, questionAnswered: true,
          whatWasRight: ['clear'], whatWasWrong: [], betterWording: [], dontForget: [], aiFeedback: 'ok',
        },
        {
          userId: 'u-two', sessionId: session.id, question: { id: q.id, text: q.text, type: q.type, tags: q.tags, bankId: q.bankId },
          evidence: { transcript: 'it diffs a tree', audioRef: 'https://r2.example/new', words: 4, wpm: 100, fillerCount: 0, fillerRate: 0, longPauses: 0 },
          provenance: { status: 'COMPLETED' }, questionAnswered: true,
          scores: { answerQuality: 7, technicalAccuracy: 7, clarityScore: 6, starScore: 6, impactScore: 6, terminologyUsage: 6 },
          feedback: { whatWasRight: ['clear'], text: 'ok' }, confidenceScore: 6, intonationScore: 5,
        }
      );
      expect(out.attemptId).toBeTruthy();
      const item = await app.sessionItem.findUniqueOrThrow({ where: { id: out.sessionItemId } });
      expect(item.attemptId).toBe(out.attemptId);
      const attempt = await app.attempt.findUniqueOrThrow({
        where: { id: out.attemptId! },
        include: { evidence: true, evaluations: { include: { measurements: true } }, learner: true },
      });
      expect(attempt).toMatchObject({ surface: 'WRITTEN_TO_SPOKEN', responseMode: 'SPOKEN', source: 'practice-api', sessionId: session.id, questionId: q.id, promptSnapshot: 'Describe the virtual DOM.' });
      expect(attempt.learner.userId).toBe('u-two');
      expect(attempt.evidence).toMatchObject({ transcript: 'it diffs a tree', audioRef: 'https://r2.example/new', words: 4 });
      expect(attempt.evaluations.map((e) => e.kind).sort()).toEqual(['AI_RUBRIC', 'DETERMINISTIC']);
      // the canonical and legacy overall score agree
      const overall = attempt.evaluations.flatMap((e) => e.measurements).find((m) => m.metric === 'answerQuality');
      expect(overall?.value).toBe(item.answerQuality);
    });

    it('a failed analysis is recorded as FAILED while the legacy row keeps the canned numbers the UI shows', async () => {
      const session = await app.session.create({ data: { userId: 'u-two', title: 'Failed', bankId: null } });
      const q = await app.question.findFirstOrThrow({ where: { text: 'Explain closures.' } });
      const out = await persistPracticeAnswer(
        app,
        { sessionId: session.id, questionId: q.id, transcript: 'a few words here ok', answerQuality: 4, starScore: 4, whatWasRight: [], whatWasWrong: [], betterWording: [], dontForget: [], aiFeedback: 'AI analysis temporarily unavailable' },
        {
          userId: 'u-two', sessionId: session.id, question: { id: q.id, text: q.text, type: q.type, tags: q.tags, bankId: q.bankId },
          evidence: { transcript: 'a few words here ok', audioRef: null, words: 5, wpm: null, fillerCount: null, fillerRate: null, longPauses: null },
          provenance: { status: 'FAILED', reason: 'timeout' }, questionAnswered: null,
          scores: { answerQuality: 4, starScore: 4 }, feedback: {}, confidenceScore: null, intonationScore: null,
        }
      );
      const ai = await app.attemptEvaluation.findFirstOrThrow({ where: { attemptId: out.attemptId! }, include: { measurements: true } });
      expect(ai).toMatchObject({ status: 'FAILED', failureReason: 'timeout' });
      expect(ai.measurements).toHaveLength(0);
      expect((await app.sessionItem.findUniqueOrThrow({ where: { id: out.sessionItemId } })).answerQuality).toBe(4);
    });

    it('if the ledger write fails the request fails and neither representation commits', async () => {
      const session = await app.session.create({ data: { userId: 'u-two', title: 'Atomic', bankId: null } });
      const q = await app.question.findFirstOrThrow({ where: { text: 'Explain closures.' } });
      await expect(
        persistPracticeAnswer(
          app,
          { sessionId: session.id, questionId: q.id, transcript: 'x', whatWasRight: [], whatWasWrong: [], betterWording: [], dontForget: [] },
          {
            userId: 'u-two', sessionId: session.id, question: { id: q.id, text: '   ', tags: [], bankId: null }, // an empty prompt is refused by the ledger
            evidence: { transcript: 'x', audioRef: null, words: 1, wpm: null, fillerCount: null, fillerRate: null, longPauses: null },
            provenance: { status: 'COMPLETED' }, questionAnswered: null, scores: {}, feedback: {}, confidenceScore: null, intonationScore: null,
          }
        )
      ).rejects.toThrow();
      expect(await app.sessionItem.count({ where: { sessionId: session.id } })).toBe(0);
      expect(await app.attempt.count({ where: { sessionId: session.id } })).toBe(0);
    });

    it('if the legacy insert fails after the attempt was written, the attempt is rolled back too', async () => {
      const q = await app.question.findFirstOrThrow({ where: { text: 'Explain closures.' } });
      const before = await app.attempt.count();
      await expect(
        persistPracticeAnswer(
          app,
          { sessionId: 'no-such-session', questionId: q.id, transcript: 'x', whatWasRight: [], whatWasWrong: [], betterWording: [], dontForget: [] },
          {
            userId: 'u-two', sessionId: 'no-such-session', question: { id: q.id, text: q.text, tags: [], bankId: null },
            evidence: { transcript: 'x', audioRef: null, words: 1, wpm: null, fillerCount: null, fillerRate: null, longPauses: null },
            provenance: { status: 'COMPLETED' }, questionAnswered: null, scores: {}, feedback: {}, confidenceScore: null, intonationScore: null,
          }
        )
      ).rejects.toThrow();
      expect(await app.attempt.count()).toBe(before);
    });
  });

  describe('divergence check', () => {
    it('every check runs and every check is clean: no unlinked answer exists, because a failed ledger write fails the request', async () => {
      const { CHECKS } = await import('@/scripts/ledger-check');
      const result: Record<string, number> = {};
      for (const c of CHECKS) result[c.name] = Number((await rows<{ n: number }>(c.sql))[0].n);
      expect(result).toMatchObject({
        'users-without-learner': 0,
        'principals-without-learner': 0,
        'principal-learner-mismatch': 0,
        'attempt-learner-differs-from-session-owner': 0,
        'overall-score-differs': 0,
        'quiz-attempts-without-attempt': 0,
      });
      expect(result['owned-session-items-without-attempt']).toBe(0);
    });
  });

  describe('identity boundaries', () => {
    it('a machine principal must be bound to a learner: the binding is required, with no fallback through its user', async () => {
      await expect(
        run(`INSERT INTO "MachinePrincipal" ("id","name","tokenHash","tokenPrefix","scopes","userId") VALUES ('mp-x','x','${'g'.repeat(64)}','ipm_xxxx',ARRAY['banks:read'],'u-admin')`)
      ).rejects.toThrow(/23502/); // not-null violation
    });

    it('a principal is never a learner: no learner row is keyed by a principal, and attempts record it only as the actor', async () => {
      expect(await rows(`SELECT 1 FROM "Learner" l JOIN "MachinePrincipal" m ON m."id" = l."id" OR m."id" = l."userId"`)).toHaveLength(0);
      const col = await rows<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'Learner'`);
      expect(col.map((c) => c.column_name).sort()).toEqual(['createdAt', 'id', 'userId']);
    });

    it('goals are context only: creating or completing one produces no attempt, evidence or measurement', async () => {
      const before = await rows<{ n: number }>(`SELECT ((SELECT count(*) FROM "Attempt") + (SELECT count(*) FROM "AttemptEvidence") + (SELECT count(*) FROM "AttemptMeasurement"))::int AS n`);
      await run(`INSERT INTO "Goal" ("id","learnerId","title","updatedAt") VALUES ('g1','lrn_u-admin','Interview prep',now())`);
      await run(`UPDATE "Goal" SET "status" = 'ACHIEVED', "updatedAt" = now() WHERE "id" = 'g1'`);
      const after = await rows<{ n: number }>(`SELECT ((SELECT count(*) FROM "Attempt") + (SELECT count(*) FROM "AttemptEvidence") + (SELECT count(*) FROM "AttemptMeasurement"))::int AS n`);
      expect(after).toEqual(before);
      expect(await rows(`SELECT 1 FROM "Attempt" WHERE "goalId" IS NOT NULL`)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------------- rollback

  describe('rollbacks (docs/p2-rollback.sql, then docs/p1-rollback.sql)', () => {
    const structuralDiff = (commit: string, file: string) => {
      const prev = spawnSync('git', ['show', `${commit}:prisma/schema.prisma`], { cwd: root, encoding: 'utf8' });
      if (prev.status !== 0) return null; // that commit is not in this checkout: the structural diff is skipped
      writeFileSync(file, prev.stdout);
      return spawnSync('npx', ['prisma', 'migrate', 'diff', '--from-url', ownerUrl, '--to-schema-datamodel', file, '--exit-code'], {
        env: { ...process.env, DATABASE_URL: ownerUrl, DATABASE_MIGRATION_URL: ownerUrl },
        encoding: 'utf8',
        cwd: root,
      });
    };
    const legacyCount = async () =>
      (await rows<{ n: bigint }>(`SELECT (SELECT count(*) FROM "SessionItem") + (SELECT count(*) FROM "Session") + (SELECT count(*) FROM "Question") AS n`))[0].n;

    it('P2 rollback returns the schema to exactly the P1 shape and leaves the whole P1 ledger and legacy rows untouched', async () => {
      const before = { legacy: await legacyCount(), attempts: (await rows<{ n: bigint }>(`SELECT count(*) AS n FROM "Attempt"`))[0].n };
      for (const st of splitSql(readFileSync(join(root, 'docs', 'p2-rollback.sql'), 'utf8'))) await run(st);
      expect(await legacyCount()).toBe(before.legacy);
      expect((await rows<{ n: bigint }>(`SELECT count(*) AS n FROM "Attempt"`))[0].n).toBe(before.attempts);
      expect(await rows(`SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" LIKE '%p2_native_sync'`)).toHaveLength(0);
      const diff = structuralDiff('1952c92', join(tmp, 'p1-shape.prisma'));
      if (diff) expect(diff.status, diff.stdout + diff.stderr).toBe(0);
      // the P1 append-only guard is back and still refuses edits
      await expect(run(`UPDATE "Attempt" SET "promptSnapshot" = 'x' WHERE "id" = 'att_si-ok'`)).rejects.toThrow(/append-only/);
    });

    it('P1 rollback then returns the schema to exactly the pre-P1 shape and leaves every legacy row untouched', async () => {
      const before = await legacyCount();
      for (const st of splitSql(readFileSync(join(root, 'docs', 'p1-rollback.sql'), 'utf8'))) await run(st);
      expect(await legacyCount()).toBe(before);
      expect(await rows(`SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" LIKE '%p1_learner_attempt_ledger'`)).toHaveLength(0);
      const diff = structuralDiff(PRE_P1_COMMIT, join(tmp, 'pre-p1.prisma'));
      if (diff) expect(diff.status, diff.stdout + diff.stderr).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------- builds

  describe('builds', () => {
    it('perform zero migrations: the build script only generates the client and builds', () => {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
      expect(pkg.scripts.build).toBe('prisma generate && next build');
      for (const [name, cmd] of Object.entries(pkg.scripts)) {
        if (name === 'build' || name === 'postinstall') expect(cmd).not.toMatch(/migrate|db push/);
      }
    });
  });
});
