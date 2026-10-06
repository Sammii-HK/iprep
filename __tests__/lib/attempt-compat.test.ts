import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendReanalysis, persistPracticeAnswer, spokenAnswerEvaluations, type PracticeCanonical } from '@/lib/attempt-compat';

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

  it('never loses the learner\'s answer when the ledger write fails: saves the legacy row alone and says so', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = {
      $transaction: vi.fn(async () => {
        throw new Error('relation "Attempt" does not exist');
      }),
      sessionItem: { create: vi.fn(async () => ({ id: 'item-2' })) },
    };
    const out = await persistPracticeAnswer(db as never, legacy, canonical);
    expect(out).toEqual({ sessionItemId: 'item-2', attemptId: null });
    expect(db.sessionItem.create).toHaveBeenCalledWith({ data: legacy, select: { id: true } });
    expect(error).toHaveBeenCalled();
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

describe('appendReanalysis', () => {
  it('appends evaluations and records the corrected text only when it differs from the evidence', async () => {
    const tx = txClient();
    const db = { $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
    const ok = await appendReanalysis(db as never, 'attempt-1', {
      recordedTranscript: 'hello thare',
      correctedTranscript: 'hello there',
      provenance: { status: 'COMPLETED' },
      questionAnswered: true,
      scores: { answerQuality: 8 },
      feedback: {},
      confidenceScore: null,
      intonationScore: null,
    });
    expect(ok).toBe(true);
    expect(tx.attempt.create).not.toHaveBeenCalled();
    expect(tx.attemptEvaluation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ evaluatedText: 'hello there', kind: 'AI_RUBRIC' }) })
    );
  });

  it('does nothing for an answer with no canonical attempt (unowned or ledger write failed)', async () => {
    const db = { $transaction: vi.fn() };
    expect(await appendReanalysis(db as never, null, {} as never)).toBe(false);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
