import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyReanalysis, persistPracticeAnswer, spokenAnswerEvaluations, type PracticeCanonical } from '@/lib/attempt-compat';

const legacy = { sessionId: 's1', questionId: 'q1', transcript: 'hello there', whatWasRight: [], whatWasWrong: [], betterWording: [], dontForget: [] };

const canonical: PracticeCanonical = {
  userId: 'user-1',
  sessionId: 's1',
  question: { id: 'q1', text: 'Explain closures.', type: 'TECHNICAL', tags: ['js'], bankId: 'b1' },
  evidence: { transcript: 'hello there', audioRef: 'https://r2.example/a', words: 2, wpm: 120, fillerCount: 0, fillerRate: 0, longPauses: 0 },
  provenance: { status: 'COMPLETED' },
  questionAnswered: true,
  scores: { answerQuality: 7, technicalAccuracy: 6, clarityScore: 8, starScore: 6, impactScore: 6, terminologyUsage: 5 },
  feedback: { whatWasRight: ['clear'], text: 'ok' },
  confidenceScore: 6,
  intonationScore: 5,
};

function txClient() {
  let evalN = 0;
  const tx = {
    learner: { upsert: vi.fn(async () => ({ id: 'learner-1' })) },
    attempt: { create: vi.fn<(args: unknown) => Promise<{ id: string }>>(async () => ({ id: 'attempt-1' })), findUnique: vi.fn(async () => ({ surface: 'WRITTEN_TO_SPOKEN' })) },
    attemptEvaluation: { create: vi.fn<(args: unknown) => Promise<{ id: string }>>(async () => ({ id: `eval-${++evalN}` })) },
    attemptMeasurement: { createMany: vi.fn<(args: unknown) => Promise<{ count: number }>>(async () => ({ count: 1 })) },
    sessionItem: { create: vi.fn<(args: unknown) => Promise<{ id: string }>>(async () => ({ id: 'item-1' })) },
  };
  return tx;
}

afterEach(() => vi.restoreAllMocks());

describe('persistPracticeAnswer', () => {
  it('writes the attempt and the legacy row in one transaction, and the legacy row carries the attempt id', async () => {
    const tx = txClient();
    const db = { $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)), sessionItem: { create: vi.fn() } };
    const out = await persistPracticeAnswer(db as never, legacy, canonical);
    expect(out).toEqual({ sessionItemId: 'item-1', attemptId: 'attempt-1' });
    expect(tx.attempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          learnerId: 'learner-1',
          surface: 'WRITTEN_TO_SPOKEN',
          responseMode: 'SPOKEN',
          source: 'practice-api',
          sessionId: 's1',
          questionId: 'q1',
          promptSnapshot: 'Explain closures.',
        }),
      })
    );
    expect(tx.sessionItem.create).toHaveBeenCalledWith({ data: { ...legacy, attemptId: 'attempt-1' }, select: { id: true } });
    expect(db.sessionItem.create).not.toHaveBeenCalled();
  });

  it('writes an AI evaluation and a separate delivery evaluation', async () => {
    const tx = txClient();
    const db = { $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)), sessionItem: { create: vi.fn() } };
    await persistPracticeAnswer(db as never, legacy, canonical);
    const kinds = tx.attemptEvaluation.create.mock.calls.map((c) => (c[0] as { data: { kind: string } }).data.kind);
    expect(kinds).toEqual(['AI_RUBRIC', 'DETERMINISTIC']);
  });

  it('fails the request when the ledger write fails: nothing is committed and there is no legacy-only fallback', async () => {
    const db = {
      $transaction: vi.fn(async () => {
        throw new Error('relation "Attempt" does not exist');
      }),
      sessionItem: { create: vi.fn() },
    };
    await expect(persistPracticeAnswer(db as never, legacy, canonical)).rejects.toThrow(/does not exist/);
    expect(db.sessionItem.create).not.toHaveBeenCalled();
  });

  it('writes the legacy row inside the same transaction as the ledger, so a failure after the attempt rolls both back', async () => {
    const tx = txClient();
    tx.sessionItem.create.mockRejectedValueOnce(new Error('session deleted'));
    const db = { $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)), sessionItem: { create: vi.fn() } };
    await expect(persistPracticeAnswer(db as never, legacy, canonical)).rejects.toThrow(/session deleted/);
    expect(db.sessionItem.create).not.toHaveBeenCalled(); // the rejected transaction is the only write path
  });
});

describe('spokenAnswerEvaluations', () => {
  it('a failed analysis keeps its (valid) delivery scores but no AI scores', () => {
    const evals = spokenAnswerEvaluations({ ...canonical, provenance: { status: 'FAILED', reason: 'timeout' } });
    expect(evals).toHaveLength(2);
    expect(evals[0]).toMatchObject({ kind: 'AI_RUBRIC', status: 'FAILED', failureReason: 'timeout', measurements: [] });
    expect(evals[1].measurements.map((m) => m.metric)).toEqual(['confidenceScore', 'intonationScore']);
  });

  it('missing scores stay missing: no zero-filled measurements', () => {
    const [ai] = spokenAnswerEvaluations({ ...canonical, scores: { answerQuality: 7 }, confidenceScore: null, intonationScore: null });
    expect(ai.measurements.map((m) => m.metric)).toEqual(['answerQuality']);
  });
});

describe('applyReanalysis', () => {
  const args = {
    attemptId: 'attempt-1',
    sessionItemId: 'item-1',
    legacyUpdate: { answerQuality: 8, transcript: 'hello there' },
    recordedTranscript: 'hello thare',
    correctedTranscript: 'hello there',
    provenance: { status: 'COMPLETED' } as const,
    questionAnswered: true,
    scores: { answerQuality: 8 },
    feedback: {},
    confidenceScore: null,
    intonationScore: null,
  };
  const dbFor = (tx: ReturnType<typeof txClient> & { sessionItem: { update?: unknown } }) => ({
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  });

  it('appends the evaluation (with the corrected text) and updates the legacy projection in one transaction', async () => {
    const tx = { ...txClient(), sessionItem: { update: vi.fn(async () => ({})) } };
    await applyReanalysis(dbFor(tx as never) as never, args);
    expect(tx.attempt.create).not.toHaveBeenCalled();
    expect(tx.attemptEvaluation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ evaluatedText: 'hello there', kind: 'AI_RUBRIC', status: 'COMPLETED' }) })
    );
    expect(tx.sessionItem.update).toHaveBeenCalledWith({ where: { id: 'item-1' }, data: args.legacyUpdate });
  });

  it('a failed evaluator is recorded as FAILED with no measurements and the legacy row is NOT touched', async () => {
    const tx = { ...txClient(), sessionItem: { update: vi.fn(async () => ({})) } };
    await applyReanalysis(dbFor(tx as never) as never, { ...args, provenance: { status: 'FAILED', reason: 'timeout' } });
    expect(tx.attemptEvaluation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'AI_RUBRIC', status: 'FAILED', failureReason: 'timeout' }) })
    );
    expect(tx.attemptMeasurement.createMany).toHaveBeenCalledTimes(0);
    expect(tx.sessionItem.update).not.toHaveBeenCalled();
  });

  it('refuses an answer with no canonical attempt', async () => {
    const db = { $transaction: vi.fn() };
    await expect(applyReanalysis(db as never, { ...args, attemptId: null })).rejects.toThrow(/no canonical attempt/);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
