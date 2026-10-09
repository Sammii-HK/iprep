/**
 * Pull: the learner's changes since an opaque cursor.
 *
 * Correctness (see docs/P2_CURSOR_PROOF.md): every SyncChange row carries the id of the transaction that wrote it
 * (`txid`, a 64-bit id from pg_current_xact_id). A reader takes `H = pg_snapshot_xmin(pg_current_snapshot())` in the
 * SAME statement as its read: every transaction with an id below H has finished (committed or aborted), so no row
 * with txid < H can still appear. The pull serves only rows with txid < H, ordered by (txid, id), after the cursor
 * (txid, id). A change that commits late carries a txid at or above the in-flight horizon, so it cannot be skipped by
 * a cursor that already moved past a later-committing neighbour. Gaps (rollbacks, other learners' rows) are harmless
 * because the cursor is a position, not a count.
 *
 * Only append-only entities are fed (attempts and their evaluations), so there are no deletions to propagate and no
 * cursor expiry. The one deliberate invalidation is the operator-controlled epoch (after a database restore the
 * transaction ids rewind), which tells clients to pull again from the start.
 */
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../errors';
import { evaluationState } from './events';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export interface CursorPosition {
  epoch: number;
  txid: bigint;
  id: bigint;
}

export function encodeCursor(c: CursorPosition): string {
  return Buffer.from(JSON.stringify({ e: c.epoch, t: c.txid.toString(), i: c.id.toString() })).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPosition {
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { e?: unknown; t?: unknown; i?: unknown };
    if (typeof raw.e !== 'number' || typeof raw.t !== 'string' || typeof raw.i !== 'string') throw new Error('shape');
    if (!/^\d{1,19}$/.test(raw.t) || !/^\d{1,19}$/.test(raw.i)) throw new Error('digits');
    return { epoch: raw.e, txid: BigInt(raw.t), id: BigInt(raw.i) };
  } catch {
    throw new AppError('Invalid cursor', 400, 'INVALID_CURSOR');
  }
}

export interface AttemptView {
  id: string;
  clientEventId: string | null;
  source: string;
  surface: string;
  responseMode: string;
  occurredAt: string;
  recordedAt: string;
  occurredAtSuspect: boolean;
  prompt: {
    text: string;
    questionId: string | null;
    questionRevisionId: string | null;
    type: string | null;
    tags: string[];
    bankId: string | null;
  };
  contentLinkage: string;
  evidence: {
    transcript: string | null;
    responseText: string | null;
    transcriber: string | null;
    words: number | null;
    wpm: number | null;
    fillerCount: number | null;
    fillerRate: number | null;
    longPauses: number | null;
    durationMs: number | null;
  } | null;
  evaluation: {
    state: 'not_evaluated' | 'evaluated' | 'evaluation_failed';
    evaluations: Array<{
      id: string;
      kind: string;
      status: string;
      evaluatorVersion: string;
      evaluatedAt: string | null;
      measurements: Array<{ dimension: string | null; metric: string; value: number; scaleMin: number; scaleMax: number }>;
    }>;
  };
}

export interface Change {
  entityType: 'attempt';
  entityId: string;
  kind: 'upsert';
  data: AttemptView;
}

export interface PullResult {
  changes: Change[];
  nextCursor: string | null;
  hasMore: boolean;
  epoch: number;
  serverTime: string;
}

interface Row {
  id: bigint;
  txid: bigint;
  entityId: string;
}

export async function currentEpoch(db: PrismaClient): Promise<number> {
  const row = await db.syncEpoch.findUnique({ where: { id: 1 } });
  return row?.epoch ?? 1;
}

/** The raw page query, exported so the concurrency proof can exercise exactly what production runs. */
export async function readChangePage(
  db: Pick<PrismaClient, '$queryRaw'>,
  learnerId: string,
  after: { txid: bigint; id: bigint },
  limit: number
): Promise<Row[]> {
  return db.$queryRaw<Row[]>`
    WITH horizon AS (SELECT pg_snapshot_xmin(pg_current_snapshot())::text::bigint AS h)
    SELECT c."id", c."txid", c."entityId"
    FROM "SyncChange" c, horizon
    WHERE c."learnerId" = ${learnerId}
      AND c."txid" < horizon.h
      AND (c."txid", c."id") > (${after.txid}::bigint, ${after.id}::bigint)
    ORDER BY c."txid", c."id"
    LIMIT ${limit}`;
}

export async function pullChanges(
  db: PrismaClient,
  learnerId: string,
  args: { cursor?: string | null; limit?: number }
): Promise<PullResult> {
  const epoch = await currentEpoch(db);
  const limit = Math.min(Math.max(Math.floor(args.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);

  let after = { txid: BigInt(0), id: BigInt(0) };
  if (args.cursor) {
    const c = decodeCursor(args.cursor);
    if (c.epoch !== epoch) throw new AppError('The sync history was reset; pull again from the start', 409, 'EPOCH_CHANGED', { epoch });
    after = { txid: c.txid, id: c.id };
  }

  const rows = await readChangePage(db, learnerId, after, limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // One entry per attempt per page (latest state), in feed order.
  const ids: string[] = [];
  for (const r of page) {
    const at = ids.indexOf(r.entityId);
    if (at >= 0) ids.splice(at, 1);
    ids.push(r.entityId);
  }
  const attempts = await db.attempt.findMany({
    where: { id: { in: ids }, learnerId },
    include: {
      evidence: true,
      evaluations: { include: { measurements: true }, orderBy: { recordedAt: 'asc' } },
    },
  });
  const byId = new Map(attempts.map((a) => [a.id, a]));
  const changes: Change[] = [];
  for (const id of ids) {
    const a = byId.get(id);
    if (!a) continue; // purged since it was announced
    changes.push({
      entityType: 'attempt',
      entityId: a.id,
      kind: 'upsert',
      data: {
        id: a.id,
        clientEventId: a.clientEventId,
        source: a.source,
        surface: a.surface,
        responseMode: a.responseMode,
        occurredAt: a.occurredAt.toISOString(),
        recordedAt: a.recordedAt.toISOString(),
        occurredAtSuspect: a.occurredAtSuspect,
        prompt: {
          text: a.promptSnapshot,
          questionId: a.questionId,
          questionRevisionId: a.questionRevisionId,
          type: a.questionType,
          tags: a.tagsSnapshot,
          bankId: a.bankId,
        },
        contentLinkage: a.contentLinkage,
        evidence: a.evidence
          ? {
              transcript: a.evidence.transcript,
              responseText: a.evidence.responseText,
              transcriber: a.evidence.transcriber,
              words: a.evidence.words,
              wpm: a.evidence.wpm,
              fillerCount: a.evidence.fillerCount,
              fillerRate: a.evidence.fillerRate,
              longPauses: a.evidence.longPauses,
              durationMs: a.evidence.durationMs,
            }
          : null,
        evaluation: {
          state: evaluationState(a.evaluations),
          evaluations: a.evaluations.map((e) => ({
            id: e.id,
            kind: e.kind,
            status: e.status,
            evaluatorVersion: e.evaluatorVersion,
            evaluatedAt: e.evaluatedAt?.toISOString() ?? null,
            measurements: e.measurements.map((m) => ({
              dimension: m.dimension,
              metric: m.metric,
              value: m.value,
              scaleMin: m.scaleMin,
              scaleMax: m.scaleMax,
            })),
          })),
        },
      },
    });
  }

  const last = page[page.length - 1];
  const nextCursor = last
    ? encodeCursor({ epoch, txid: last.txid, id: last.id })
    : args.cursor ?? encodeCursor({ epoch, txid: BigInt(0), id: BigInt(0) });
  return { changes, nextCursor, hasMore, epoch, serverTime: new Date().toISOString() };
}
