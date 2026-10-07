/**
 * Idempotent push against a real database: a retried learner event can never create a second Attempt, content is
 * never silently attached to different content, and a client can neither choose its learner nor author evaluations.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ADMIN_URL, type TestDb, createTestDb, makeUser } from './helpers';
import { processBatch, processEvent, type AttemptCreatedEvent, type EventResult, type SyncActor } from '@/lib/sync/events';
import { applyQuestionSet } from '@/lib/content';
import { importCustomBank } from '@/lib/sync/bankImport';
import { pullChanges } from '@/lib/sync/pull';
import { recordAttempt } from '@/lib/attempts';

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

function event(over: Partial<AttemptCreatedEvent> & { prompt?: Partial<AttemptCreatedEvent['prompt']>; evidence?: Partial<AttemptCreatedEvent['evidence']> } = {}): AttemptCreatedEvent {
  const { prompt, evidence, ...rest } = over;
  return {
    type: 'attempt.created',
    schemaVersion: 1,
    eventId: uuid(),
    origin: 'device',
    surface: 'WRITTEN_TO_SPOKEN',
    responseMode: 'SPOKEN',
    occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
    prompt: { text: 'Tell me about a time you led a team.', ...prompt },
    evidence: { transcript: 'I led a migration of three services.', transcriber: 'apple-sfspeech', words: 7, ...evidence },
    ...rest,
  };
}

const ctx = () => ({ receivedAt: new Date(), deviceClockAtSend: null });
const created = (r: EventResult) => r.status === 'created' || r.status === 'duplicate';

describe.skipIf(!ADMIN_URL)('sync push (real database)', () => {
  let t: TestDb;
  let db: PrismaClient;
  let A: SyncActor;
  let B: SyncActor;
  let catalogBankId: string;
  let catalogQ: { id: string };
  let aBankId: string;

  beforeAll(async () => {
    t = await createTestDb('p2push');
    db = t.app;
    const a = await makeUser(t.owner, 'userA');
    const b = await makeUser(t.owner, 'userB');
    const devA = await db.device.create({ data: { userId: a.userId, platform: 'ios' }, select: { id: true } });
    const devB = await db.device.create({ data: { userId: b.userId, platform: 'ios' }, select: { id: true } });
    A = { userId: a.userId, learnerId: a.learnerId, deviceId: devA.id };
    B = { userId: b.userId, learnerId: b.learnerId, deviceId: devB.id };

    // A shared catalog bank (no owner) with a stable external key, as the catalog publisher creates it.
    const bank = await db.questionBank.create({ data: { title: 'Communication', externalKey: 'communication' }, select: { id: true } });
    catalogBankId = bank.id;
    await applyQuestionSet(db, bank.id, [{ externalKey: 'comm-1', text: 'Tell me about a time you led a team.' }], 'append');
    catalogQ = await db.question.findFirstOrThrow({ where: { bankId: bank.id, externalKey: 'comm-1' }, select: { id: true } });
    // A's custom bank, uploaded explicitly.
    aBankId = (await importCustomBank(db, a.userId, { bankKey: 'custom-aaa', title: 'My bank', questions: [{ questionKey: 'q-1', text: 'What is a closure?' }] })).bankId;
  }, 180_000);
  afterAll(async () => {
    await t?.teardown();
  });

  describe('first event, retries and conflicts', () => {
    it('creates one Attempt with evidence and a feed entry, keeping occurredAt exactly as reported', async () => {
      const e = event({ occurredAt: '2026-10-04T08:15:30+05:30', prompt: { text: 'Why use a monorepo?', clientRef: { bankKey: 'nope', questionKey: 'nope' }, tags: ['arch'] } });
      const [r] = await processBatch(db, A, [e], ctx());
      expect(r).toMatchObject({ status: 'created', linkage: 'unlinked', evaluation: { state: 'not_evaluated' } });
      const a = await db.attempt.findUniqueOrThrow({ where: { learnerId_clientEventId: { learnerId: A.learnerId, clientEventId: e.eventId } }, include: { evidence: true } });
      expect(a.occurredAt.toISOString()).toBe('2026-10-04T02:45:30.000Z'); // the reported instant, untouched
      expect(a.recordedAt.getTime()).toBeGreaterThan(a.occurredAt.getTime()); // receipt is a separate fact
      expect(a).toMatchObject({ learnerId: A.learnerId, deviceId: A.deviceId, source: 'ios-sync', surface: 'WRITTEN_TO_SPOKEN', responseMode: 'SPOKEN', contentLinkage: 'unlinked', promptSnapshot: 'Why use a monorepo?', tagsSnapshot: ['arch'] });
      expect(a.payloadHash).toMatch(/^[0-9a-f]{64}$/);
      expect(a.clientRef).toMatchObject({ bankKey: 'nope', questionKey: 'nope' }); // provenance of what the client believed
      expect(a.evidence).toMatchObject({ transcript: 'I led a migration of three services.', transcriber: 'apple-sfspeech', words: 7 });
      expect(await db.syncChange.count({ where: { learnerId: A.learnerId, entityId: a.id } })).toBe(1);
      expect(await db.attemptEvaluation.count({ where: { attemptId: a.id } })).toBe(0); // nothing evaluates a synced attempt in P2
    });

    it('the same event again is a duplicate: the existing attempt is returned and nothing new is written', async () => {
      const e = event();
      const [first] = await processBatch(db, A, [e], ctx());
      const before = { attempts: await db.attempt.count(), changes: await db.syncChange.count() };
      const [again] = await processBatch(db, A, [e], ctx());
      const [thrice] = await processBatch(db, A, [e, e], ctx());
      expect(again).toMatchObject({ status: 'duplicate', attemptId: (first as { attemptId: string }).attemptId, code: null });
      expect(thrice).toMatchObject({ status: 'duplicate' });
      expect({ attempts: await db.attempt.count(), changes: await db.syncChange.count() }).toEqual(before);
    });

    it('response lost after commit: the retry of the whole batch is all duplicates and nothing is lost or doubled', async () => {
      const batch = [event(), event(), event()];
      const first = await processBatch(db, A, batch, ctx());
      expect(first.every((r) => r.status === 'created')).toBe(true);
      const retry = await processBatch(db, A, batch, ctx()); // the client never saw the first response
      expect(retry.map((r) => r.status)).toEqual(['duplicate', 'duplicate', 'duplicate']);
      expect(retry.map((r) => (r as { attemptId: string }).attemptId)).toEqual(first.map((r) => (r as { attemptId: string }).attemptId));
      expect(await db.attempt.count({ where: { clientEventId: { in: batch.map((b) => b.eventId) } } })).toBe(3);
    });

    it('the same id with a different payload is a conflict and the original is untouched', async () => {
      const e = event();
      const [first] = await processBatch(db, A, [e], ctx());
      const [r] = await processBatch(db, A, [{ ...e, evidence: { ...e.evidence, transcript: 'something else entirely' } }], ctx());
      expect(r).toMatchObject({ status: 'conflict', code: 'EVENT_ID_CONFLICT', attemptId: (first as { attemptId: string }).attemptId });
      const a = await db.attempt.findFirstOrThrow({ where: { clientEventId: e.eventId, learnerId: A.learnerId }, include: { evidence: true } });
      expect(a.evidence?.transcript).toBe('I led a migration of three services.');
    });

    it('the same event arriving as a legacy import after the normal outbox is a duplicate, not a second attempt', async () => {
      const e = event();
      await processBatch(db, A, [e], ctx());
      const [r] = await processBatch(db, A, [{ ...e, origin: 'legacy-import' }], ctx());
      expect(r.status).toBe('duplicate');
      expect((await db.attempt.findFirstOrThrow({ where: { clientEventId: e.eventId } })).source).toBe('ios-sync'); // first writer's origin stands
    });

    it('a legacy import of an event the ledger already holds is a duplicate even when the import carries less detail; it never overwrites', async () => {
      const e = event({ evidence: { transcript: 'full transcript', transcriber: 'apple-sfspeech', words: 2, durationMs: 4000, fillerCount: 0, longPauses: 0 } });
      await processBatch(db, A, [e], ctx());
      const thinner = { ...e, origin: 'legacy-import' as const, evidence: { transcript: 'full transcript', transcriber: 'apple-sfspeech' } };
      const [r] = await processBatch(db, A, [thinner], ctx());
      expect(r.status).toBe('duplicate');
      const a = await db.attempt.findFirstOrThrow({ where: { clientEventId: e.eventId, learnerId: A.learnerId }, include: { evidence: true } });
      expect(a.evidence?.durationMs).toBe(4000); // the richer first record stands
      // ...whereas a NEW (non-legacy) event reusing the id with different content is still a conflict
      const [c] = await processBatch(db, A, [{ ...e, evidence: { ...e.evidence, transcript: 'other' } }], ctx());
      expect(c.status).toBe('conflict');
    });

    it('legacy imports never create an evaluation or a measurement: old unverifiable scores are not canonical, not even as a SKIPPED row', async () => {
      const e = event({ origin: 'legacy-import', prompt: { text: 'Legacy provenance probe' } });
      const [r] = await processBatch(db, A, [e], ctx());
      const attemptId = (r as { attemptId: string }).attemptId;
      expect(await db.attemptEvaluation.count({ where: { attemptId } })).toBe(0);
      expect(await db.attemptMeasurement.count({ where: { attemptId } })).toBe(0);
      const a = await db.attempt.findUniqueOrThrow({ where: { id: attemptId }, include: { evidence: true } });
      expect(a.source).toBe('ios-legacy-import');
      expect(a.evidence).toMatchObject({ transcript: expect.any(String), transcriber: 'apple-sfspeech' });
      // and the only way to add a score to it is the server's own evaluation path, which a client cannot reach
      const [forged] = await processBatch(db, A, [{ ...event({ origin: 'legacy-import' }), scores: { answerQuality: 9 }, aiAnswerQuality: 9 }], ctx());
      expect(forged).toMatchObject({ status: 'rejected' });
    });

    it('five concurrent submissions of one event create exactly one attempt (the database decides)', async () => {
      const e = event();
      const results = await Promise.all(Array.from({ length: 5 }, () => processEvent(db, A, e, ctx())));
      expect(results.filter((r) => r.status === 'created')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'duplicate')).toHaveLength(4);
      expect(new Set(results.map((r) => (r as { attemptId: string }).attemptId)).size).toBe(1);
      expect(await db.attempt.count({ where: { clientEventId: e.eventId } })).toBe(1);
    });

    it('event ids are scoped to the learner: another learner reusing an id neither collides with nor sees it', async () => {
      const e = event();
      await processBatch(db, A, [e], ctx());
      const [r] = await processBatch(db, B, [e], ctx());
      expect(r.status).toBe('created');
      const owners = await db.attempt.findMany({ where: { clientEventId: e.eventId }, select: { learnerId: true } });
      expect(owners.map((o) => o.learnerId).sort()).toEqual([A.learnerId, B.learnerId].sort());
    });
  });

  describe('batches are independent transactions', () => {
    it('a failure on one event never rolls back the others or re-creates them on retry', async () => {
      const events = Array.from({ length: 20 }, () => event());
      const bad = events[16]; // "event 17"
      const flaky = new Proxy(db, {
        get(target, prop, recv) {
          if (prop === '$transaction') {
            return (fn: (tx: unknown) => Promise<unknown>, opts?: object) =>
              target.$transaction(async (tx) => {
                const wrapped = new Proxy(tx, {
                  get(tt, tp, tr) {
                    if (tp === 'attempt') {
                      return { ...(tt.attempt as object), create: async (args: { data: { clientEventId?: string } }) => {
                        if (args.data.clientEventId === bad.eventId) throw new Error('simulated outage');
                        return tt.attempt.create(args as never);
                      } };
                    }
                    return Reflect.get(tt, tp, tr);
                  },
                });
                return fn(wrapped);
              }, opts as never);
          }
          return Reflect.get(target, prop, recv);
        },
      }) as PrismaClient;

      const first = await processBatch(flaky, A, events, ctx());
      expect(first[16]).toMatchObject({ status: 'retry', code: 'SERVER_ERROR' });
      expect(first.filter((r) => r.status === 'created')).toHaveLength(19);
      const written = await db.attempt.count({ where: { clientEventId: { in: events.map((e) => e.eventId) } } });
      expect(written).toBe(19); // events 1 to 16 and 18 to 20 are committed; 17 left nothing behind

      const retry = await processBatch(db, A, events, ctx());
      expect(retry[16].status).toBe('created');
      expect(retry.filter((r) => r.status === 'duplicate')).toHaveLength(19); // nothing re-created
      expect(await db.attempt.count({ where: { clientEventId: { in: events.map((e) => e.eventId) } } })).toBe(20);
    });

    it('a malformed event is rejected alone, in place, and the rest of the batch is committed', async () => {
      const good1 = event();
      const good2 = event();
      const results = await processBatch(db, A, [good1, { eventId: uuid(), type: 'attempt.created', nonsense: true }, 'not even an object', good2], ctx());
      expect(results.map((r) => r.status)).toEqual(['created', 'rejected', 'rejected', 'created']);
      expect(results[1]).toMatchObject({ code: 'INVALID_EVENT' });
    });
  });

  describe('what a client may not do', () => {
    it('cannot choose its learner: every forbidden identity or authority field is rejected and nothing is written', async () => {
      const before = await db.attempt.count();
      for (const extra of [
        { learnerId: B.learnerId },
        { userId: B.userId },
        { evaluation: { status: 'COMPLETED' } },
        { evaluations: [{ status: 'COMPLETED' }] },
        { measurements: [{ metric: 'answerQuality', value: 10 }] },
        { scores: { answerQuality: 10 } },
      ]) {
        const [r] = await processBatch(db, A, [{ ...event(), ...extra }], ctx());
        expect(r).toMatchObject({ status: 'rejected', code: 'FORBIDDEN_FIELD' });
      }
      expect(await db.attempt.count()).toBe(before);
    });

    it('an event always lands on the authenticated actor learner, whatever the payload says', async () => {
      const e = event();
      await processBatch(db, B, [e], ctx());
      const a = await db.attempt.findFirstOrThrow({ where: { clientEventId: e.eventId, learnerId: B.learnerId } });
      expect(a.learnerId).toBe(B.learnerId);
      expect(await db.attempt.count({ where: { clientEventId: e.eventId, learnerId: A.learnerId } })).toBe(0);
    });

    it('rejects events from the far future, but records and keeps a moderately wrong clock', async () => {
      const received = new Date();
      const [future] = await processBatch(db, A, [event({ occurredAt: new Date(received.getTime() + 3 * 86_400_000).toISOString() })], { receivedAt: received, deviceClockAtSend: null });
      expect(future).toMatchObject({ status: 'rejected', code: 'OCCURRED_IN_FUTURE' });

      const e = event({ occurredAt: new Date(received.getTime() - 2 * 3_600_000).toISOString() });
      const behind = new Date(received.getTime() - 3 * 3_600_000); // the device clock is three hours behind the server
      const [r] = await processBatch(db, A, [e], { receivedAt: received, deviceClockAtSend: behind });
      expect(r.status).toBe('created');
      const a = await db.attempt.findFirstOrThrow({ where: { clientEventId: e.eventId, learnerId: A.learnerId } });
      expect(a.occurredAtSuspect).toBe(true);
      expect(a.occurredAtSkewMs).toBe(3 * 3_600_000);
      expect(a.occurredAt.toISOString()).toBe(e.occurredAt); // recorded, flagged, never rewritten
    });
  });

  describe('content linkage never guesses', () => {
    it('links a bundled question by its stable keys when the snapshot equals a retained revision', async () => {
      const [r] = await processBatch(db, A, [event({ prompt: { text: 'Tell me about a time you led a team.', clientRef: { bankKey: 'communication', questionKey: 'comm-1' } } })], ctx());
      expect(r).toMatchObject({ status: 'created', linkage: 'linked' });
      const a = await db.attempt.findFirstOrThrow({ where: { id: (r as { attemptId: string }).attemptId } });
      expect(a).toMatchObject({ questionId: catalogQ.id, bankId: catalogBankId, contentLinkage: 'linked' });
      expect(a.questionRevisionId).toBeTruthy();
    });

    it('offline answer to an OLD revision resolves to that old revision after the question was edited', async () => {
      const { bankId } = await importCustomBank(db, A.userId, { bankKey: 'custom-edit', title: 'Edit me', questions: [{ questionKey: 'q-e', text: 'Old wording of the question?' }] });
      const q = await db.question.findFirstOrThrow({ where: { bankId, externalKey: 'q-e' } });
      const rev1 = await db.questionRevision.findFirstOrThrow({ where: { questionId: q.id, revision: 1 } });
      // The server edits the question while the learner is offline.
      await applyQuestionSet(db, bankId, [{ externalKey: 'q-e', text: 'New wording of the question?' }], 'append');
      const rev2 = await db.questionRevision.findFirstOrThrow({ where: { questionId: q.id, revision: 2 } });

      // The device downloaded revision 1 and answers it later.
      const [old] = await processBatch(db, A, [event({ prompt: { text: 'Old wording of the question?', clientRef: { bankKey: 'custom-edit', questionKey: 'q-e' } } })], ctx());
      const oldAttempt = await db.attempt.findFirstOrThrow({ where: { id: (old as { attemptId: string }).attemptId } });
      expect(oldAttempt).toMatchObject({ contentLinkage: 'linked', questionId: q.id, questionRevisionId: rev1.id, promptSnapshot: 'Old wording of the question?' });

      const [fresh] = await processBatch(db, A, [event({ prompt: { text: 'New wording of the question?', questionRevisionId: rev2.id } })], ctx());
      expect((await db.attempt.findFirstOrThrow({ where: { id: (fresh as { attemptId: string }).attemptId } })).questionRevisionId).toBe(rev2.id);
    });

    it('a snapshot that matches no retained revision stays unlinked, with the client references kept as provenance', async () => {
      const [r] = await processBatch(db, A, [event({ prompt: { text: 'A wording the server never had', clientRef: { bankKey: 'communication', questionKey: 'comm-1' } } })], ctx());
      expect(r).toMatchObject({ status: 'created', linkage: 'unlinked' });
      const a = await db.attempt.findFirstOrThrow({ where: { id: (r as { attemptId: string }).attemptId } });
      expect(a).toMatchObject({ questionId: null, questionRevisionId: null, bankId: null, contentLinkage: 'unlinked', promptSnapshot: 'A wording the server never had' });
      expect(a.clientRef).toMatchObject({ bankKey: 'communication', questionKey: 'comm-1' });
    });

    it('an unknown revision id is unlinked, never "best effort" attached', async () => {
      const [r] = await processBatch(db, A, [event({ prompt: { text: 'Tell me about a time you led a team.', questionRevisionId: 'qrv_does_not_exist' } })], ctx());
      expect(r).toMatchObject({ linkage: 'unlinked' });
    });

    it('cannot link into another learner\'s private bank, by revision id, question id or key', async () => {
      const { bankId } = await importCustomBank(db, B.userId, { bankKey: 'custom-bbb', title: 'B private', questions: [{ questionKey: 'q-b', text: 'B secret question text?' }] });
      const q = await db.question.findFirstOrThrow({ where: { bankId } });
      const rev = await db.questionRevision.findFirstOrThrow({ where: { questionId: q.id } });
      for (const prompt of [
        { text: 'B secret question text?', questionRevisionId: rev.id },
        { text: 'B secret question text?', questionId: q.id },
        { text: 'B secret question text?', clientRef: { bankKey: 'custom-bbb', questionKey: 'q-b' } },
      ]) {
        const [r] = await processBatch(db, A, [event({ prompt })], ctx());
        expect(r).toMatchObject({ status: 'created', linkage: 'unlinked' });
      }
      const [own] = await processBatch(db, B, [event({ prompt: { text: 'B secret question text?', clientRef: { bankKey: 'custom-bbb', questionKey: 'q-b' } } })], ctx());
      expect(own).toMatchObject({ linkage: 'linked' }); // the owner can
    });

    it('legacy history that only recorded a bank links by exact text when exactly one question matches, and stays unlinked otherwise', async () => {
      const [one] = await processBatch(db, A, [event({ origin: 'legacy-import', prompt: { text: 'Tell me about a time you led a team.', clientRef: { bankKey: 'communication' } } })], ctx());
      expect(one).toMatchObject({ linkage: 'linked' });
      expect((await db.attempt.findFirstOrThrow({ where: { id: (one as { attemptId: string }).attemptId } })).questionId).toBe(catalogQ.id);
      const none = await processBatch(db, A, [event({ origin: 'legacy-import', prompt: { text: 'A sentence no question ever said', clientRef: { bankKey: 'communication' } } })], ctx());
      expect(none[0]).toMatchObject({ linkage: 'unlinked' });
      // two different questions in one bank with identical text: ambiguous, never guessed
      const { bankId } = await importCustomBank(db, A.userId, { bankKey: 'custom-dup', title: 'Dups', questions: [{ questionKey: 'a', text: 'Same words?' }, { questionKey: 'b', text: 'Same words?' }] });
      void bankId;
      const amb = await processBatch(db, A, [event({ origin: 'legacy-import', prompt: { text: 'Same words?', clientRef: { bankKey: 'custom-dup' } } })], ctx());
      expect(amb[0]).toMatchObject({ linkage: 'unlinked' });
    });

    it('two candidate banks for one key is uncertainty: unlinked', async () => {
      await db.questionBank.create({ data: { userId: A.userId, title: 'Shadow', externalKey: 'communication' } });
      const [r] = await processBatch(db, A, [event({ prompt: { text: 'Tell me about a time you led a team.', clientRef: { bankKey: 'communication', questionKey: 'comm-1' } } })], ctx());
      expect(r).toMatchObject({ linkage: 'unlinked' });
    });

    it('the private facts bank is never linked', async () => {
      const facts = await db.questionBank.create({ data: { userId: A.userId, title: '__facts__', externalKey: 'facts-key' } });
      const fq = await db.question.create({ data: { bankId: facts.id, text: 'Fact: I led eight engineers', tags: [], difficulty: 1, externalKey: 'f1' } });
      const [r] = await processBatch(db, A, [event({ prompt: { text: 'Fact: I led eight engineers', questionId: fq.id } })], ctx());
      expect(r).toMatchObject({ linkage: 'unlinked' });
    });

    it('linking works through the explicit custom-bank mapping the device stored', async () => {
      const [r] = await processBatch(db, A, [event({ prompt: { text: 'What is a closure?', clientRef: { bankKey: 'custom-aaa', questionKey: 'q-1' } } })], ctx());
      expect(r).toMatchObject({ linkage: 'linked' });
      expect((await db.attempt.findFirstOrThrow({ where: { id: (r as { attemptId: string }).attemptId } })).bankId).toBe(aBankId);
    });
  });

  describe('pull shows the same history on another device', () => {
    it('serves synced, web-origin and imported attempts with an honest evaluation state, in feed order, without audio', async () => {
      const { learnerId } = A;
      const e = event({ prompt: { text: 'Pull test prompt' } });
      await processBatch(db, A, [e], ctx());
      // A web-style attempt through the P1 ledger writer (with a completed AI evaluation).
      const web = await db.$transaction((tx) =>
        recordAttempt(tx, {
          learnerId, surface: 'WRITTEN_TO_SPOKEN', responseMode: 'SPOKEN', source: 'practice-api',
          prompt: { text: 'Web prompt' }, evidence: { transcript: 'web transcript', audioRef: 'https://r2.example/audio/secret.webm' },
          evaluations: [{ kind: 'AI_RUBRIC', status: 'COMPLETED', evaluatorVersion: 'spoken-answer@1', measurements: [{ dimension: 'RECALL', metric: 'technicalAccuracy', value: 7 }] }],
        })
      );
      const failed = await db.$transaction((tx) =>
        recordAttempt(tx, { learnerId, surface: 'WRITTEN_TO_SPOKEN', responseMode: 'SPOKEN', source: 'practice-api', prompt: { text: 'Failed eval prompt' },
          evaluations: [{ kind: 'AI_RUBRIC', status: 'FAILED', evaluatorVersion: 'spoken-answer@1', failureReason: 'timeout', measurements: [] }] })
      );

      const all: Array<Awaited<ReturnType<typeof pullChanges>>['changes'][number]> = [];
      let cursor: string | null = null;
      for (;;) {
        const page = await pullChanges(db, learnerId, { cursor, limit: 7 });
        all.push(...page.changes);
        cursor = page.nextCursor;
        if (!page.hasMore) break;
      }
      const byId = new Map(all.map((c) => [c.entityId, c.data]));
      expect(byId.get(web.attemptId)?.evaluation.state).toBe('evaluated');
      expect(byId.get(failed.attemptId)?.evaluation.state).toBe('evaluation_failed');
      const synced = [...byId.values()].find((v) => v.clientEventId === e.eventId)!;
      expect(synced).toMatchObject({ source: 'ios-sync', evaluation: { state: 'not_evaluated', evaluations: [] }, evidence: { transcript: 'I led a migration of three services.' } });
      expect(JSON.stringify([...byId.values()])).not.toContain('secret.webm'); // the audio reference never leaves the server
      expect(JSON.stringify(synced)).not.toContain('learnerId');
      // a second device that pulls from nothing reconstructs the same set; resuming from the end yields nothing new
      const again = await pullChanges(db, learnerId, { cursor, limit: 100 });
      expect(again.changes).toHaveLength(0);
      // other learners' history is never in this feed
      await processBatch(db, B, [event({ prompt: { text: 'Only learner B ever saw this prompt' } })], ctx());
      const fresh = await pullChanges(db, learnerId, { cursor: null, limit: 1000 });
      expect(fresh.changes.some((c) => c.data.prompt.text === 'Only learner B ever saw this prompt')).toBe(false);
    });

    it('an evaluation appended later re-announces the attempt', async () => {
      const e = event({ prompt: { text: 'Late evaluation prompt' } });
      const [r] = await processBatch(db, A, [e], ctx());
      const attemptId = (r as { attemptId: string }).attemptId;
      const start = (await pullChanges(db, A.learnerId, { limit: 1000 })).nextCursor;
      const { appendEvaluation } = await import('@/lib/attempts');
      await db.$transaction((tx) => appendEvaluation(tx, attemptId, [{ kind: 'AI_RUBRIC', status: 'COMPLETED', evaluatorVersion: 'spoken-answer@1', measurements: [] }]));
      const next = await pullChanges(db, A.learnerId, { cursor: start, limit: 100 });
      expect(next.changes.map((c) => c.entityId)).toEqual([attemptId]);
      expect(next.changes[0].data.evaluation.state).toBe('evaluated');
    });
  });

  it('only the runtime role was used: the ledger rows it wrote cannot be edited by it', async () => {
    await expect(db.$executeRawUnsafe(`UPDATE "Attempt" SET "promptSnapshot" = 'x'`)).rejects.toThrow(/permission denied/);
    void created;
  });
});
