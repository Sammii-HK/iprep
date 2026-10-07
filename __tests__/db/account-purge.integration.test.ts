/**
 * The owner-level account purge: removes every trace of a deleted learner despite the append-only ledger, only after
 * the grace period, only with the owner credential, and never touches anyone else.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ADMIN_URL, type TestDb, createTestDb, makeUser } from './helpers';
import { audioKeyFromRef, dueForPurge, purgeAccount } from '@/lib/native/purge';
import { type AudioObjectStore, deleteAudioObjects } from '@/lib/audio-store';
import { requestAccountDeletion } from '@/lib/native/account';
import { recordAttempt } from '@/lib/attempts';
import { processBatch } from '@/lib/sync/events';
import { createDevice, issueTokens } from '@/lib/native/session';
import { hashCode, generateInviteCode } from '@/lib/native/codes';

describe('audio key extraction', () => {
  it('finds the R2 object key in endpoint URLs, public URLs and bare keys, and nothing else', () => {
    expect(audioKeyFromRef('https://abc123.r2.cloudflarestorage.com/iprep-bucket/audio/1700000000-ab12.webm')).toBe('audio/1700000000-ab12.webm');
    expect(audioKeyFromRef('https://cdn.example.com/audio/x.m4a?sig=1')).toBe('audio/x.m4a');
    expect(audioKeyFromRef('audio/plain.webm')).toBe('audio/plain.webm');
    expect(audioKeyFromRef('https://example.com/other/file.mp3')).toBeNull();
    expect(audioKeyFromRef(null)).toBeNull();
  });
});

describe.skipIf(!ADMIN_URL)('account purge (real database)', () => {
  let t: TestDb;
  let app: PrismaClient;
  let owner: PrismaClient;
  let X: { userId: string; learnerId: string };
  let Y: { userId: string; learnerId: string };
  const TRANSCRIPT = 'a distinctive spoken sentence about my salary history';

  async function seedLearner(u: { userId: string; learnerId: string }, tag: string, withAudio: boolean) {
    const device = await createDevice(app, u.userId, { platform: 'ios' });
    await issueTokens(app, { userId: u.userId, deviceId: device.id, secret: 's'.repeat(32) });
    await app.authIdentity.create({ data: { userId: u.userId, provider: 'apple', subject: `sub-${tag}` } });
    await app.accountLinkCode.create({ data: { userId: u.userId, codeHash: hashCode(`LINK-${tag}`), expiresAt: new Date(Date.now() + 1000) } });
    const invite = generateInviteCode();
    await app.nativeInvite.create({ data: { codeHash: hashCode(invite), expiresAt: new Date(Date.now() + 1000), usedAt: new Date(), usedByUserId: u.userId } });
    const mp = await app.machinePrincipal.create({ data: { name: `mp-${tag}`, tokenHash: `${tag}`.padEnd(64, 'a'), tokenPrefix: 'ipm_xxxx', scopes: ['banks:read'], userId: u.userId, learnerId: u.learnerId } });
    await app.machineAudit.create({ data: { principalId: mp.id, method: 'GET', path: '/x', scope: 'banks:read', status: 200 } });
    const bank = await app.questionBank.create({ data: { userId: u.userId, title: `bank-${tag}`, questions: { create: [{ text: `private question ${tag}`, tags: [], difficulty: 3 }] } }, include: { questions: true } });
    const session = await app.session.create({ data: { userId: u.userId, title: 's', bankId: bank.id } });
    const attempt = await app.$transaction((tx) =>
      recordAttempt(tx, {
        learnerId: u.learnerId, surface: 'WRITTEN_TO_SPOKEN', responseMode: 'SPOKEN', source: 'practice-api', sessionId: session.id,
        prompt: { questionId: bank.questions[0].id, text: `private question ${tag}`, bankId: bank.id },
        evidence: { transcript: `${TRANSCRIPT} ${tag}`, audioRef: withAudio ? `https://acct.r2.cloudflarestorage.com/iprep-bucket/audio/${tag}-1.webm` : null },
        evaluations: [{ kind: 'AI_RUBRIC', status: 'COMPLETED', evaluatorVersion: 'v1', feedback: { text: `feedback ${TRANSCRIPT}` }, measurements: [{ dimension: 'RECALL', metric: 'technicalAccuracy', value: 7 }] }],
      })
    );
    await app.sessionItem.create({ data: { sessionId: session.id, questionId: bank.questions[0].id, transcript: `${TRANSCRIPT} legacy ${tag}`, audioUrl: withAudio ? `https://acct.r2.cloudflarestorage.com/iprep-bucket/audio/${tag}-legacy.webm` : null, attemptId: attempt.attemptId, whatWasRight: [], whatWasWrong: [], betterWording: [], dontForget: [] } });
    await app.goal.create({ data: { learnerId: u.learnerId, title: `goal ${tag}` } });
    await app.userQuestionProgress.create({ data: { userId: u.userId, questionId: bank.questions[0].id } });
    await app.learningSummary.create({ data: { userId: u.userId, sessionId: session.id, commonMistakes: [], performanceByTag: {}, weakTags: [], strongTags: [], recommendedFocus: [] } });
    await app.userLearningInsight.create({ data: { userId: u.userId, aggregatedWeakTags: [], aggregatedStrongTags: [], topFocusAreas: [] } });
    const folder = await app.bankFolder.create({ data: { userId: u.userId, title: 'f', items: { create: [{ bankId: bank.id }] } } });
    await app.interview.create({ data: { userId: u.userId, company: 'Acme', role: 'Eng', startsAt: new Date() } });
    const quiz = await app.quiz.create({ data: { userId: u.userId, title: 'q', bankId: bank.id } });
    await app.quizAttempt.create({ data: { quizId: quiz.id, questionId: bank.questions[0].id, answer: `quiz answer ${TRANSCRIPT}` } });
    const synced = await processBatch(app, { userId: u.userId, learnerId: u.learnerId, deviceId: device.id }, [{
      type: 'attempt.created', schemaVersion: 1, eventId: `00000000-0000-4000-8000-${tag === 'X' ? '000000000001' : '000000000002'}`, origin: 'device', surface: 'WRITTEN_TO_SPOKEN', responseMode: 'SPOKEN',
      occurredAt: new Date(Date.now() - 1000).toISOString(), prompt: { text: `synced prompt ${tag}` }, evidence: { transcript: `${TRANSCRIPT} synced ${tag}`, transcriber: 'apple-sfspeech' },
    }], { receivedAt: new Date(), deviceClockAtSend: null });
    expect(synced[0].status).toBe('created');
    await app.$executeRaw`INSERT INTO "RateLimitBucket" ("key","windowStart","count") VALUES (${`ai:practice:${u.userId}:burst`}, now(), 1)`;
    return { bank, folder };
  }

  const rowsFor = async (u: { userId: string; learnerId: string }) => ({
    user: await owner.user.count({ where: { id: u.userId } }),
    learner: await owner.learner.count({ where: { id: u.learnerId } }),
    attempts: await owner.attempt.count({ where: { learnerId: u.learnerId } }),
    evidence: await owner.attemptEvidence.count({ where: { attempt: { learnerId: u.learnerId } } }),
    evaluations: await owner.attemptEvaluation.count({ where: { attempt: { learnerId: u.learnerId } } }),
    measurements: await owner.attemptMeasurement.count({ where: { attempt: { learnerId: u.learnerId } } }),
    sessions: await owner.session.count({ where: { userId: u.userId } }),
    sessionItems: await owner.sessionItem.count({ where: { session: { userId: u.userId } } }),
    banks: await owner.questionBank.count({ where: { userId: u.userId } }),
    questions: await owner.question.count({ where: { bank: { userId: u.userId } } }),
    quizzes: await owner.quiz.count({ where: { userId: u.userId } }),
    devices: await owner.device.count({ where: { userId: u.userId } }),
    identities: await owner.authIdentity.count({ where: { userId: u.userId } }),
    principals: await owner.machinePrincipal.count({ where: { userId: u.userId } }),
    syncChanges: await owner.syncChange.count({ where: { learnerId: u.learnerId } }),
    syncLog: await owner.syncEventLog.count({ where: { learnerId: u.learnerId } }),
    goals: await owner.goal.count({ where: { learnerId: u.learnerId } }),
    interviews: await owner.interview.count({ where: { userId: u.userId } }),
    folders: await owner.bankFolder.count({ where: { userId: u.userId } }),
    insights: await owner.userLearningInsight.count({ where: { userId: u.userId } }),
    buckets: Number((await owner.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "RateLimitBucket" WHERE position(${u.userId} in "key") > 0`)[0].n),
  });

  beforeAll(async () => {
    t = await createTestDb('p2purge');
    app = t.app;
    owner = t.owner;
    X = await makeUser(owner, 'purge-x');
    Y = await makeUser(owner, 'keep-y');
    await seedLearner(X, 'X', true);
    await seedLearner(Y, 'Y', true);
  }, 180_000);
  afterAll(async () => {
    await t?.teardown();
  });

  it('refuses an account that never asked to be deleted, and one still inside its grace period', async () => {
    await expect(purgeAccount(owner, X.userId)).rejects.toMatchObject({ code: 'PURGE_NOT_REQUESTED' });
    await requestAccountDeletion(app, X.userId, new Date());
    await expect(purgeAccount(owner, X.userId)).rejects.toMatchObject({ code: 'PURGE_GRACE_PERIOD' });
    expect(await dueForPurge(owner)).not.toContain(X.userId);
    expect((await rowsFor(X)).attempts).toBeGreaterThan(0); // nothing was removed
  });

  it('the runtime role can neither purge nor weaken the ledger to do it', async () => {
    await owner.user.update({ where: { id: X.userId }, data: { purgeAfter: new Date(Date.now() - 1000) } });
    expect(await dueForPurge(owner)).toContain(X.userId);
    await expect(purgeAccount(app, X.userId)).rejects.toMatchObject({ code: 'PURGE_NEEDS_OWNER' });
    await expect(app.$executeRawUnsafe(`DELETE FROM "Attempt"`)).rejects.toThrow(/permission denied/);
    // even the owner cannot delete ledger rows outside the purge's own maintenance transaction
    await expect(owner.$executeRawUnsafe(`DELETE FROM "AttemptEvidence" WHERE "attemptId" IN (SELECT id FROM "Attempt" WHERE "learnerId" = '${X.learnerId}')`)).rejects.toThrow(/append-only/);
    expect((await rowsFor(X)).attempts).toBeGreaterThan(0);
  });

  it('removes every trace of the account, returns the audio keys, and leaves only a receipt of counts', async () => {
    const yBefore = await rowsFor(Y);
    const before = await rowsFor(X);
    const bankIdOfX = (await owner.questionBank.findFirstOrThrow({ where: { userId: X.userId } })).id;
    expect(before.attempts).toBe(2);
    expect(before.sessionItems).toBe(1);

    const out = await purgeAccount(owner, X.userId);
    expect(Object.values(await rowsFor(X)).every((n) => n === 0)).toBe(true); // all 21 categories are gone
    // Every object a row referenced for X, plus the generated study episode files of the bank X owned. Nothing of Y's.
    const bankX = bankIdOfX;
    expect(out.audioKeys.sort()).toEqual(['audio/X-1.webm', 'audio/X-legacy.webm', `audio/study/${bankX}.json`, `audio/study/${bankX}.mp3`, `audio/study/${bankX}.txt`].sort());
    expect(out.audioKeys.some((k) => k.includes('Y-'))).toBe(false);

    // Deleting them through the adapter (a fake: no real bucket is ever contacted) removes exactly those objects.
    const bucket = new Set<string>([...out.audioKeys, 'audio/Y-1.webm', 'audio/orphan-no-owner-trail.webm', 'audio/study/manifest.json']);
    const fake: AudioObjectStore = { deleteObject: async (k) => { bucket.delete(k); } };
    const report = await deleteAudioObjects(fake, out.audioKeys);
    expect(report.complete).toBe(true);
    expect([...bucket].sort()).toEqual(['audio/Y-1.webm', 'audio/orphan-no-owner-trail.webm', 'audio/study/manifest.json']);
    // DOCUMENTED LIMIT (docs/P2_NATIVE_SYNC.md, R2 ownership audit): an object that no database row references has no
    // ownership trail, so no purge can find it. It is still in the bucket above.
    expect(out.audioKeys).not.toContain('audio/orphan-no-owner-trail.webm');
    expect(out.counts).toMatchObject({ attempt: 2, attemptEvidence: 2, attemptEvaluation: 1, attemptMeasurement: 1, sessionItem: 1, device: 1, authIdentity: 1, machinePrincipal: 1, user: 1, learner: 1, rateLimitBucket: 1 });

    // Nobody else was touched.
    expect(await rowsFor(Y)).toEqual(yBefore);

    // Nothing identifying survives anywhere: not the user id, not a transcript, not a prompt snapshot.
    const receipt = await owner.accountDeletionReceipt.findFirstOrThrow();
    const dump = JSON.stringify(receipt);
    expect(dump).not.toContain(X.userId);
    expect(dump).not.toContain('salary');
    expect(Object.keys(receipt.counts as object).every((k) => typeof (receipt.counts as Record<string, unknown>)[k] === 'number')).toBe(true);
    const leftovers = await owner.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM "AttemptEvidence" WHERE "transcript" LIKE '%synced X%' OR "transcript" LIKE '% X' OR "transcript" LIKE '%legacy X%'`
    );
    expect(Number(leftovers[0].n)).toBe(0);
    expect(Number((await owner.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "Attempt" WHERE "promptSnapshot" LIKE '%X'`))[0].n)).toBe(0);
    expect(await owner.nativeInvite.count({ where: { usedByUserId: X.userId } })).toBe(0); // the redemption no longer points at them
  });

  it('maintenance mode does not leak: after the purge the ledger is append-only again for everyone', async () => {
    await expect(owner.$executeRawUnsafe(`DELETE FROM "Attempt" WHERE "learnerId" = '${Y.learnerId}'`)).rejects.toThrow(/append-only/);
    expect((await rowsFor(Y)).attempts).toBe(2);
  });

  it('the receipt table cannot be edited by the runtime role', async () => {
    await expect(app.$executeRawUnsafe(`UPDATE "AccountDeletionReceipt" SET "counts" = '{}'`)).rejects.toThrow(/permission denied/);
    await expect(app.$executeRawUnsafe(`DELETE FROM "AccountDeletionReceipt"`)).rejects.toThrow(/permission denied/);
  });

  it('is atomic: a failure part-way rolls the whole purge back', async () => {
    const Z = await makeUser(owner, 'purge-z');
    await seedLearner(Z, 'Z', false);
    await requestAccountDeletion(app, Z.userId, new Date());
    await owner.user.update({ where: { id: Z.userId }, data: { purgeAfter: new Date(Date.now() - 1000) } });
    const before = await rowsFor(Z);
    // A trigger that fails on the final user delete simulates an unexpected error at the end of the procedure.
    await owner.$executeRawUnsafe(`CREATE FUNCTION p2_fail_user_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated failure'; END; $$`);
    await owner.$executeRawUnsafe(`CREATE TRIGGER p2_fail BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION p2_fail_user_delete()`);
    try {
      await expect(purgeAccount(owner, Z.userId)).rejects.toThrow(/simulated failure/);
      expect(await rowsFor(Z)).toEqual(before); // nothing was half-deleted
    } finally {
      await owner.$executeRawUnsafe(`DROP TRIGGER p2_fail ON "User"`);
    }
    await expect(purgeAccount(owner, Z.userId)).resolves.toMatchObject({ userId: Z.userId });
    expect(Object.values(await rowsFor(Z)).every((n) => n === 0)).toBe(true);
  });
});
