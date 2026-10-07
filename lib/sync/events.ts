/**
 * Push: client-created learning events become canonical Attempts exactly once.
 *
 *  - The client event id is permanent idempotency: UNIQUE (learnerId, clientEventId) is enforced by the database.
 *  - The server computes the canonical hash of the immutable payload. Same id + same hash is a duplicate (the
 *    existing attempt is returned); same id + different hash is a conflict and nothing is overwritten.
 *  - Each event is its own transaction: a failure on event 17 never undoes events 1 to 16 or re-creates them.
 *  - A client cannot choose its Learner, and cannot supply evaluations or measurements (strict schema).
 *  - occurredAt is stored exactly as the device reported it. Clock skew is recorded, never corrected in place.
 */
import { createHash } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { resolvePrompt } from '../content';

export const MAX_BATCH = 50;
export const SKEW_SUSPECT_MS = 5 * 60_000;
export const MAX_FUTURE_MS = 24 * 60 * 60_000;

const QuestionTypeValues = ['BEHAVIORAL', 'TECHNICAL', 'DEFINITION', 'SCENARIO', 'PITCH'] as const;

const nonNegInt = z.number().int().min(0).max(10_000_000);

export const AttemptCreatedSchema = z
  .object({
    type: z.literal('attempt.created'),
    schemaVersion: z.literal(1),
    eventId: z.string().uuid(),
    origin: z.enum(['device', 'legacy-import']),
    surface: z.literal('WRITTEN_TO_SPOKEN'),
    responseMode: z.literal('SPOKEN'),
    occurredAt: z.string().datetime({ offset: true }),
    prompt: z
      .object({
        text: z.string().min(1).max(4000),
        questionId: z.string().min(1).max(64).nullish(),
        questionRevisionId: z.string().min(1).max(64).nullish(),
        clientRef: z
          .object({ bankKey: z.string().min(1).max(128).nullish(), questionKey: z.string().min(1).max(128).nullish() })
          .strict()
          .nullish(),
        type: z.enum(QuestionTypeValues).nullish(),
        tags: z.array(z.string().min(1).max(64)).max(20).nullish(),
      })
      .strict(),
    evidence: z
      .object({
        transcript: z.string().min(1).max(60_000),
        transcriber: z.string().min(1).max(64),
        words: nonNegInt.nullish(),
        wpm: nonNegInt.nullish(),
        durationMs: nonNegInt.nullish(),
        fillerCount: nonNegInt.nullish(),
        longPauses: nonNegInt.nullish(),
      })
      .strict(),
    evaluationRequested: z.boolean().nullish(),
  })
  .strict();

export type AttemptCreatedEvent = z.infer<typeof AttemptCreatedSchema>;

export type EvaluationState = 'not_evaluated' | 'evaluated' | 'evaluation_failed';

export type EventResult =
  | { eventId: string | null; status: 'created' | 'duplicate'; attemptId: string; linkage: 'linked' | 'unlinked'; evaluation: { state: EvaluationState }; code: null }
  | { eventId: string | null; status: 'conflict' | 'rejected'; attemptId?: string; code: string }
  // Not processed because of a transient server failure: nothing was written, resending the same event is safe.
  | { eventId: string | null; status: 'retry'; code: 'SERVER_ERROR' };

/** Stable JSON: keys sorted, undefined and null treated alike (omitted). */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * The hash covers exactly the immutable facts of the event. `origin` and `eventId` are excluded (the same event may
 * arrive through the normal outbox and through the legacy import), and `occurredAt` is normalised to UTC so a
 * different timezone spelling of the same instant is the same event.
 */
export function canonicalPayloadHash(e: AttemptCreatedEvent): string {
  const canonical = {
    surface: e.surface,
    responseMode: e.responseMode,
    occurredAt: new Date(e.occurredAt).toISOString(),
    prompt: {
      text: e.prompt.text,
      questionId: e.prompt.questionId ?? null,
      questionRevisionId: e.prompt.questionRevisionId ?? null,
      clientRef: e.prompt.clientRef ? { bankKey: e.prompt.clientRef.bankKey ?? null, questionKey: e.prompt.clientRef.questionKey ?? null } : null,
      type: e.prompt.type ?? null,
      tags: e.prompt.tags ?? [],
    },
    evidence: {
      transcript: e.evidence.transcript,
      transcriber: e.evidence.transcriber,
      words: e.evidence.words ?? null,
      wpm: e.evidence.wpm ?? null,
      durationMs: e.evidence.durationMs ?? null,
      fillerCount: e.evidence.fillerCount ?? null,
      longPauses: e.evidence.longPauses ?? null,
    },
    evaluationRequested: e.evaluationRequested ?? null,
  };
  return createHash('sha256').update(stableStringify(canonical)).digest('hex');
}

export function evaluationState(evaluations: Array<{ status: string }>): EvaluationState {
  if (evaluations.some((e) => e.status === 'COMPLETED')) return 'evaluated';
  if (evaluations.some((e) => e.status === 'FAILED')) return 'evaluation_failed';
  return 'not_evaluated';
}

export interface SyncActor {
  userId: string;
  learnerId: string;
  deviceId: string;
}

/** Skew = how far behind the server the device clock was when it sent the batch (positive: device is behind). */
export function measureSkew(deviceClockAtSend: Date | null, receivedAt: Date, occurredAt: Date): { skewMs: number | null; suspect: boolean } {
  const skewMs = deviceClockAtSend ? receivedAt.getTime() - deviceClockAtSend.getTime() : null;
  const suspect =
    (skewMs !== null && Math.abs(skewMs) > SKEW_SUSPECT_MS) || occurredAt.getTime() > receivedAt.getTime() + SKEW_SUSPECT_MS;
  return { skewMs, suspect };
}

function sniffEventId(raw: unknown): string | null {
  const id = raw && typeof raw === 'object' ? (raw as { eventId?: unknown }).eventId : undefined;
  return typeof id === 'string' && id.length <= 64 ? id : null;
}

async function log(db: PrismaClient, actor: SyncActor, eventId: string | null, result: string, code: string | null, hash: string | null) {
  await db.syncEventLog
    .create({ data: { learnerId: actor.learnerId, deviceId: actor.deviceId, eventId: eventId ?? 'unknown', result, errorCode: code, payloadHash: hash } })
    .catch(() => undefined);
}

async function existingResult(
  db: PrismaClient,
  actor: SyncActor,
  eventId: string,
  hash: string
): Promise<EventResult | null> {
  const found = await db.attempt.findUnique({
    where: { learnerId_clientEventId: { learnerId: actor.learnerId, clientEventId: eventId } },
    select: { id: true, payloadHash: true, contentLinkage: true, evaluations: { select: { status: true } } },
  });
  if (!found) return null;
  if (found.payloadHash !== hash) return { eventId, status: 'conflict', attemptId: found.id, code: 'EVENT_ID_CONFLICT' };
  return {
    eventId,
    status: 'duplicate',
    attemptId: found.id,
    linkage: found.contentLinkage === 'linked' ? 'linked' : 'unlinked',
    evaluation: { state: evaluationState(found.evaluations) },
    code: null,
  };
}

export async function processEvent(
  db: PrismaClient,
  actor: SyncActor,
  rawEvent: unknown,
  ctx: { receivedAt: Date; deviceClockAtSend: Date | null }
): Promise<EventResult> {
  const parsed = AttemptCreatedSchema.safeParse(rawEvent);
  if (!parsed.success) {
    const eventId = sniffEventId(rawEvent);
    const forbidden =
      rawEvent && typeof rawEvent === 'object' &&
      ['learnerId', 'userId', 'evaluation', 'evaluations', 'measurement', 'measurements', 'score', 'scores'].some((k) => k in (rawEvent as object));
    const code = forbidden ? 'FORBIDDEN_FIELD' : 'INVALID_EVENT';
    await log(db, actor, eventId, 'rejected', code, null);
    return { eventId, status: 'rejected', code };
  }
  const ev = parsed.data;
  const hash = canonicalPayloadHash(ev);

  const prior = await existingResult(db, actor, ev.eventId, hash);
  if (prior) {
    await log(db, actor, ev.eventId, prior.status, prior.code ?? null, hash);
    return prior;
  }

  const occurredAt = new Date(ev.occurredAt);
  if (occurredAt.getTime() > ctx.receivedAt.getTime() + MAX_FUTURE_MS) {
    await log(db, actor, ev.eventId, 'rejected', 'OCCURRED_IN_FUTURE', hash);
    return { eventId: ev.eventId, status: 'rejected', code: 'OCCURRED_IN_FUTURE' };
  }
  const { skewMs, suspect } = measureSkew(ctx.deviceClockAtSend, ctx.receivedAt, occurredAt);
  const resolved = await resolvePrompt(db, { id: actor.userId }, ev.prompt);
  const e = ev.evidence;
  const fillerRate = e.words && e.fillerCount != null && e.words > 0 ? (e.fillerCount / e.words) * 100 : null;

  try {
    const attempt = await db.$transaction(async (tx) => {
      const created = await tx.attempt.create({
        data: {
          learnerId: actor.learnerId,
          surface: ev.surface,
          responseMode: ev.responseMode,
          source: ev.origin === 'legacy-import' ? 'ios-legacy-import' : 'ios-sync',
          occurredAt,
          clientEventId: ev.eventId,
          payloadHash: hash,
          deviceId: actor.deviceId,
          occurredAtSkewMs: skewMs,
          occurredAtSuspect: suspect,
          evaluationRequested: ev.evaluationRequested ?? null,
          contentLinkage: resolved.linkage,
          questionId: resolved.questionId,
          questionRevisionId: resolved.questionRevisionId,
          bankId: resolved.bankId,
          promptSnapshot: ev.prompt.text,
          questionType: ev.prompt.type ?? null,
          tagsSnapshot: ev.prompt.tags ?? [],
          // What the client believed it was answering, kept as provenance even when we could not resolve it.
          clientRef: {
            bankKey: ev.prompt.clientRef?.bankKey ?? null,
            questionKey: ev.prompt.clientRef?.questionKey ?? null,
            questionId: ev.prompt.questionId ?? null,
            questionRevisionId: ev.prompt.questionRevisionId ?? null,
          },
          evidence: {
            create: {
              transcript: e.transcript,
              transcriber: e.transcriber,
              words: e.words ?? null,
              wpm: e.wpm ?? null,
              durationMs: e.durationMs ?? null,
              fillerCount: e.fillerCount ?? null,
              fillerRate,
              longPauses: e.longPauses ?? null,
            },
          },
        },
        select: { id: true },
      });
      await tx.syncChange.create({ data: { learnerId: actor.learnerId, entityType: 'attempt', entityId: created.id } });
      return created;
    });
    await log(db, actor, ev.eventId, 'created', null, hash);
    return {
      eventId: ev.eventId,
      status: 'created',
      attemptId: attempt.id,
      linkage: resolved.linkage,
      evaluation: { state: 'not_evaluated' },
      code: null,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // A concurrent duplicate won the race: the database constraint decided, so answer from the winner.
      const raced = await existingResult(db, actor, ev.eventId, hash);
      if (raced) {
        await log(db, actor, ev.eventId, raced.status, raced.code ?? null, hash);
        return raced;
      }
    }
    throw error;
  }
}

export async function processBatch(
  db: PrismaClient,
  actor: SyncActor,
  events: unknown[],
  ctx: { receivedAt: Date; deviceClockAtSend: Date | null }
): Promise<EventResult[]> {
  const results: EventResult[] = [];
  for (const raw of events) {
    try {
      results.push(await processEvent(db, actor, raw, ctx));
    } catch (error) {
      // An unexpected failure on one event is reported for that event only; it never rolls back earlier events.
      console.error('Sync event failed:', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error');
      results.push({ eventId: sniffEventId(raw), status: 'retry', code: 'SERVER_ERROR' });
    }
  }
  return results;
}
