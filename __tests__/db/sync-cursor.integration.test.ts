/**
 * The proof that the transaction-horizon change feed is correct under concurrency (docs/P2_CURSOR_PROOF.md).
 * Runs the production page query (`readChangePage`) against a real local Postgres:
 *
 *   TEST_PG_ADMIN_URL=postgresql://<you>@localhost:5432/postgres pnpm test:db
 */
import { spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyDbTarget } from '@/lib/db-targets';
import { currentEpoch, decodeCursor, encodeCursor, pullChanges, readChangePage } from '@/lib/sync/pull';

const ADMIN_URL = process.env.TEST_PG_ADMIN_URL;
const root = join(__dirname, '..', '..');
const suffix = randomBytes(4).toString('hex');
const DB = `iprep_cursor_${suffix}`;

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!ADMIN_URL)('sync change feed: transaction-horizon cursor', () => {
  let admin: PrismaClient;
  let db: PrismaClient;
  let url = '';

  const insert = (tx: Pick<PrismaClient, 'syncChange'>, learnerId: string, entityId: string) =>
    tx.syncChange.create({ data: { learnerId, entityType: 'attempt', entityId } });

  /** Follow the cursor protocol exactly as a client does, to exhaustion. `after` is the position to resume from. */
  async function drain(learnerId: string, start: { txid: bigint; id: bigint } = { txid: BigInt(0), id: BigInt(0) }, limit = 3) {
    const seen: Array<{ entityId: string; txid: bigint; id: bigint }> = [];
    let after = start;
    for (;;) {
      const rows = await readChangePage(db, learnerId, after, limit);
      for (const r of rows) seen.push({ entityId: r.entityId, txid: r.txid, id: r.id });
      if (rows.length > 0) after = { txid: rows[rows.length - 1].txid, id: rows[rows.length - 1].id };
      if (rows.length < limit) return { seen, after };
    }
  }

  beforeAll(async () => {
    if (classifyDbTarget(ADMIN_URL) !== 'local') throw new Error('TEST_PG_ADMIN_URL must be a local database');
    admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
    await admin.$executeRawUnsafe(`CREATE DATABASE ${DB}`);
    url = withDb(ADMIN_URL!, DB);
    const r = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', join(root, 'prisma', 'schema.prisma')], {
      env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url },
      encoding: 'utf8',
      cwd: root,
    });
    if (r.status !== 0) throw new Error(`migrate deploy failed: ${r.stdout}${r.stderr}`);
    db = new PrismaClient({ datasources: { db: { url } }, transactionOptions: { maxWait: 20_000, timeout: 60_000 } });
    for (const id of ['L1', 'L2']) {
      await db.$executeRawUnsafe(`INSERT INTO "User" ("id","updatedAt") VALUES ('u-${id}', now())`);
      await db.$executeRawUnsafe(`INSERT INTO "Learner" ("id","userId") VALUES ('${id}','u-${id}')`);
    }
  }, 180_000);

  afterAll(async () => {
    await db?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
      await admin.$disconnect();
    }
  });

  it('the exact SQL types and functions behave as assumed on this Postgres version', async () => {
    const [v] = await db.$queryRaw<Array<{ v: string; t: string; max: string }>>`
      SELECT version() AS v, pg_typeof(pg_current_xact_id())::text AS t, (2^63 - 1)::numeric(30,0)::text AS max`;
    expect(v.t).toBe('xid8');
    const [x] = await db.$queryRaw<Array<{ a: bigint; b: bigint }>>`
      SELECT pg_current_xact_id()::text::bigint AS a, pg_current_xact_id()::text::bigint AS b`;
    expect(x.a).toBe(x.b); // stable within a transaction
    expect(typeof x.a).toBe('bigint');
    const [h] = await db.$queryRaw<Array<{ h: bigint }>>`SELECT pg_snapshot_xmin(pg_current_snapshot())::text::bigint AS h`;
    expect(typeof h.h).toBe('bigint');
    // Wraparound/representation: xid8 is a 64-bit counter that never wraps. It fits a signed BIGINT until 2^63, which
    // at a (wildly pessimistic) 10,000 transactions per second is about 29 million years.
    const years = Number(BigInt('9223372036854775807') / BigInt(10_000) / BigInt(86_400 * 365));
    expect(years).toBeGreaterThan(1_000_000);
  });

  it('a change that commits late is never skipped: the cursor cannot pass an in-flight earlier transaction', async () => {
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => (releaseA = r));
    let aHasXid!: () => void;
    const aStarted = new Promise<void>((r) => (aHasXid = r));

    // Transaction A starts first (so it holds the lower transaction id) and stays open.
    const a = db.$transaction(async (tx) => {
      await insert(tx, 'L1', 'late-A');
      aHasXid();
      await gateA;
    });
    await aStarted;

    // Transaction B starts later, inserts and COMMITS while A is still in flight.
    await db.$transaction(async (tx) => {
      await insert(tx, 'L1', 'early-B');
    });

    // A pull now: B is committed but must not be served (A, with a lower txid, could still commit behind it).
    const during = await drain('L1');
    expect(during.seen.map((s) => s.entityId)).not.toContain('early-B');
    expect(during.seen.map((s) => s.entityId)).not.toContain('late-A');

    // A commits. The same client resumes from the cursor it already holds (here: the start) and sees both, A first.
    releaseA();
    await a;
    const after = await drain('L1', during.after);
    expect(after.seen.map((s) => s.entityId)).toEqual(['late-A', 'early-B']);
  });

  it('negative control: a naive id cursor (no horizon) DOES miss a late commit, so the experiment can detect the failure it guards against', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const hasId = new Promise<void>((r) => (started = r));
    const slow = db.$transaction(async (tx) => {
      await insert(tx, 'L1', 'naive-slow');
      started();
      await gate;
    });
    await hasId;
    await db.$transaction(async (tx) => insert(tx, 'L1', 'naive-fast'));
    const naive = async (afterId: bigint) =>
      db.$queryRaw<Array<{ id: bigint; entityId: string }>>`SELECT "id", "entityId" FROM "SyncChange" WHERE "learnerId" = 'L1' AND "id" > ${afterId}::bigint ORDER BY "id"`;
    const base = (await db.$queryRaw<Array<{ m: bigint }>>`SELECT COALESCE(MAX("id"), 0) AS m FROM "SyncChange" WHERE "learnerId" = 'L1' AND "entityId" NOT IN ('naive-slow','naive-fast')`)[0].m;
    const firstPull = await naive(base);
    expect(firstPull.map((r) => r.entityId)).toEqual(['naive-fast']); // committed row served, the slow one invisible
    const cursor = firstPull[firstPull.length - 1].id; // the naive client advances past the in-flight row's id
    release();
    await slow;
    const secondPull = await naive(cursor);
    expect(secondPull.map((r) => r.entityId)).not.toContain('naive-slow'); // lost for ever: this is why the horizon exists
  });

  it('a pull that returned rows before a late commit can resume without missing the late row', async () => {
    // Earlier history is committed and already pulled.
    await db.$transaction(async (tx) => insert(tx, 'L1', 'hist-1'));
    const first = await drain('L1', { txid: BigInt(0), id: BigInt(0) });
    const cursor = first.after;

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const hasXid = new Promise<void>((r) => (started = r));
    const slow = db.$transaction(async (tx) => {
      await insert(tx, 'L1', 'slow-1');
      started();
      await gate;
    });
    await hasXid;
    await db.$transaction(async (tx) => insert(tx, 'L1', 'fast-2'));
    const mid = await drain('L1', cursor);
    expect(mid.seen).toHaveLength(0); // nothing served, so the cursor did not move past 'slow-1'
    release();
    await slow;
    const end = await drain('L1', mid.after);
    expect(end.seen.map((s) => s.entityId)).toEqual(['slow-1', 'fast-2']);
  });

  it('rollbacks leave harmless gaps', async () => {
    const before = await drain('L1');
    await expect(
      db.$transaction(async (tx) => {
        await insert(tx, 'L1', 'rolled-back-1');
        await insert(tx, 'L1', 'rolled-back-2');
        throw new Error('abort');
      })
    ).rejects.toThrow('abort');
    await db.$transaction(async (tx) => insert(tx, 'L1', 'after-rollback'));
    const after = await drain('L1', before.after);
    expect(after.seen.map((s) => s.entityId)).toEqual(['after-rollback']);
    const all = await db.syncChange.findMany({ where: { learnerId: 'L1' }, orderBy: { id: 'asc' } });
    expect(all.map((r) => r.entityId)).not.toContain('rolled-back-1');
    // ids are not contiguous (sequence values were consumed by the rollback); nothing depends on that
    const ids = all.map((r) => Number(r.id));
    expect(ids[ids.length - 1] - ids[0]).toBeGreaterThanOrEqual(ids.length - 1);
  });

  it('is safe under heavy concurrency: writers for two learners race pullers; nothing committed is ever missed or repeated', async () => {
    const WRITERS = 8;
    const PER_WRITER = 20;
    const written: Record<string, Set<string>> = { L1: new Set(), L2: new Set() };
    let writersDone = 0;

    const writer = async (w: number) => {
      for (let i = 0; i < PER_WRITER; i++) {
        const learner = (w + i) % 2 === 0 ? 'L1' : 'L2';
        const entityId = `conc-${w}-${i}`;
        await db
          .$transaction(async (tx) => {
            await insert(tx, learner, entityId);
            // Hold the transaction open for a random time so commit order differs from transaction-id order.
            await sleep(Math.floor(Math.random() * 25));
            if (i % 7 === 3) throw new Error('simulated failure'); // some rollbacks
            written[learner].add(entityId);
          })
          .catch(() => undefined);
      }
      writersDone++;
    };

    // Each puller follows the cursor protocol from "now" while the writers are running, then does a final drain.
    const pull = async (learner: string, start: { txid: bigint; id: bigint }) => {
      const got: string[] = [];
      let after = start;
      let last = start;
      const take = async () => {
        const rows = await readChangePage(db, learner, after, 4);
        for (const r of rows) {
          // The feed is strictly increasing in (txid, id): a client can never see time go backwards.
          expect(r.txid > last.txid || (r.txid === last.txid && r.id > last.id)).toBe(true);
          last = { txid: r.txid, id: r.id };
          got.push(r.entityId);
        }
        if (rows.length > 0) after = last;
        return rows.length;
      };
      while (writersDone < WRITERS) await sleep((await take()) === 0 ? 5 : 0);
      while ((await take()) > 0);
      return got;
    };

    const start1 = (await drain('L1')).after;
    const start2 = (await drain('L2')).after;
    const [g1, g2] = (await Promise.all([
      pull('L1', start1),
      pull('L2', start2),
      ...Array.from({ length: WRITERS }, (_, w) => writer(w)),
    ])) as [string[], string[]];

    const only = (ids: string[]) => ids.filter((i) => i.startsWith('conc-'));
    expect(new Set(only(g1))).toEqual(written.L1); // every committed change served, none missed
    expect(only(g1)).toHaveLength(written.L1.size); // and none repeated
    expect(new Set(only(g2))).toEqual(written.L2);
    expect(only(g2)).toHaveLength(written.L2.size);
    expect(only(g1).some((i) => written.L2.has(i))).toBe(false); // learners are isolated
    expect(written.L1.size + written.L2.size).toBeGreaterThan(100); // the experiment really ran
  }, 120_000);

  it('pagination boundaries cannot miss a change, and an interrupted pull resumes from its stored cursor', async () => {
    for (let i = 0; i < 10; i++) await db.$transaction(async (tx) => insert(tx, 'L2', `page-${i}`));
    const full = await drain('L2', { txid: BigInt(0), id: BigInt(0) }, 1000);
    const pageOnes = await drain('L2', { txid: BigInt(0), id: BigInt(0) }, 1);
    expect(pageOnes.seen.map((s) => s.id)).toEqual(full.seen.map((s) => s.id));

    // Interrupt after 4 rows, persist the cursor (encode/decode as the client would), resume.
    const firstFour = (await readChangePage(db, 'L2', { txid: BigInt(0), id: BigInt(0) }, 4)).map((r) => ({ txid: r.txid, id: r.id }));
    const saved = encodeCursor({ epoch: 1, ...firstFour[3] });
    const restored = decodeCursor(saved);
    const rest = await drain('L2', { txid: restored.txid, id: restored.id }, 3);
    expect([...firstFour.map((r) => r.id), ...rest.seen.map((r) => r.id)]).toEqual(full.seen.map((r) => r.id));
  });

  it('pullChanges returns attempts with evidence and evaluations, resumes by opaque cursor, and an epoch bump forces a clean re-pull', async () => {
    await db.$executeRawUnsafe(`INSERT INTO "Attempt" ("id","learnerId","surface","responseMode","promptSnapshot","source","occurredAt","contentLinkage")
      VALUES ('att-pull','L1','WRITTEN_TO_SPOKEN','SPOKEN','p','ios-sync',now(),'unlinked')`);
    await db.$executeRawUnsafe(`INSERT INTO "AttemptEvidence" ("id","attemptId","transcript") VALUES ('ev-pull','att-pull','hello')`);
    await db.syncChange.create({ data: { learnerId: 'L1', entityType: 'attempt', entityId: 'att-pull' } });

    const p1 = await pullChanges(db, 'L1', { limit: 1000 });
    const mine = p1.changes.find((c) => c.entityId === 'att-pull');
    expect(mine?.data.evidence?.transcript).toBe('hello');
    expect(mine?.data.evaluation.state).toBe('not_evaluated');
    expect(p1.hasMore).toBe(false);

    const p2 = await pullChanges(db, 'L1', { cursor: p1.nextCursor, limit: 1000 });
    expect(p2.changes).toHaveLength(0);
    expect(p2.nextCursor).toBe(p1.nextCursor);

    await db.syncEpoch.update({ where: { id: 1 }, data: { epoch: 2 } });
    expect(await currentEpoch(db)).toBe(2);
    await expect(pullChanges(db, 'L1', { cursor: p1.nextCursor })).rejects.toMatchObject({ code: 'EPOCH_CHANGED', statusCode: 409 });
    const fresh = await pullChanges(db, 'L1', { limit: 1000 });
    expect(fresh.changes.find((c) => c.entityId === 'att-pull')).toBeTruthy(); // the re-bootstrap is complete and deterministic
    expect(fresh.epoch).toBe(2);
    await db.syncEpoch.update({ where: { id: 1 }, data: { epoch: 1 } });
  });

  it('an idle-in-transaction session only delays freshness, never correctness', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const hasXid = new Promise<void>((r) => (started = r));
    const idle = db.$transaction(async (tx) => {
      await insert(tx, 'L2', 'idle-holder');
      started();
      await gate;
    });
    await hasXid;
    await db.$transaction(async (tx) => insert(tx, 'L2', 'behind-the-holder'));
    const start = (await drain('L2', { txid: BigInt(0), id: BigInt(0) })).after;
    const stalled = await drain('L2', start);
    expect(stalled.seen.map((s) => s.entityId)).not.toContain('behind-the-holder');
    release();
    await idle;
    const caught = await drain('L2', start);
    expect(caught.seen.map((s) => s.entityId)).toEqual(['idle-holder', 'behind-the-holder']);
  });
});
