import { describe, expect, it, vi } from 'vitest';
import { AttemptSurface, MeasurementDimension } from '@prisma/client';
import {
  DELIVERY_HEURISTICS_VERSION,
  DIMENSION_MAP_VERSION,
  EVIDENCE_DIMENSIONS,
  LedgerInputError,
  METRIC_DIMENSIONS,
  SPOKEN_ANSWER_EVALUATOR,
  aiEvaluation,
  appendEvaluation,
  deliveryEvaluation,
  latestCompleted,
  measurementsFromScores,
  recordAttempt,
  validateAttemptInput,
  type AttemptInput,
} from '@/lib/attempts';

const base: AttemptInput = {
  learnerId: 'learner-1',
  surface: 'WRITTEN_TO_SPOKEN',
  responseMode: 'SPOKEN',
  source: 'practice-api',
  prompt: { questionId: 'q1', text: 'Explain the event loop.', tags: ['js'] },
  evaluations: [],
};

describe('attempt surfaces and modes', () => {
  it('cover every current surface and the planned ones', () => {
    expect(Object.values(AttemptSurface).sort()).toEqual(
      [
        'WRITTEN_TO_SPOKEN',
        'LIVE_SPOKEN',
        'PODCAST_RETRIEVAL',
        'PODCAST_LISTEN',
        'CHALLENGE',
        'INTERVIEW_SIMULATION',
        'TYPED_RETRIEVAL',
      ].sort()
    );
  });

  it('measurement dimensions are the six agreed ones', () => {
    expect(Object.values(MeasurementDimension).sort()).toEqual(
      ['RECALL', 'EXPLANATION', 'APPLICATION', 'DELIVERY', 'DISCRIMINATION', 'EXPOSURE'].sort()
    );
  });

  it('accepts a typed retrieval, a podcast retrieval pause, a challenge and an interview simulation', () => {
    for (const [surface, responseMode] of [
      ['TYPED_RETRIEVAL', 'TYPED'],
      ['PODCAST_RETRIEVAL', 'SPOKEN'],
      ['CHALLENGE', 'SPOKEN'],
      ['INTERVIEW_SIMULATION', 'SPOKEN'],
      ['LIVE_SPOKEN', 'SPOKEN'],
    ] as const) {
      expect(() => validateAttemptInput({ ...base, surface, responseMode })).not.toThrow();
    }
  });
});

describe('exposure is not recall', () => {
  it('a listen-only attempt has no response, and every other attempt has one', () => {
    expect(() => validateAttemptInput({ ...base, surface: 'PODCAST_LISTEN', responseMode: 'SPOKEN' })).toThrow(LedgerInputError);
    expect(() => validateAttemptInput({ ...base, surface: 'WRITTEN_TO_SPOKEN', responseMode: 'NONE' })).toThrow(LedgerInputError);
    expect(() => validateAttemptInput({ ...base, surface: 'PODCAST_LISTEN', responseMode: 'NONE' })).not.toThrow();
  });

  it('a listen-only attempt can only carry EXPOSURE measurements', () => {
    const listen: AttemptInput = { ...base, surface: 'PODCAST_LISTEN', responseMode: 'NONE' };
    const withDimension = (dimension: MeasurementDimension | null): AttemptInput => ({
      ...listen,
      evaluations: [
        {
          kind: 'DETERMINISTIC',
          status: 'COMPLETED',
          evaluatorVersion: 'listen@1',
          measurements: [{ dimension, metric: 'listened', value: 1, scaleMin: 0, scaleMax: 1 }],
        },
      ],
    });
    expect(() => validateAttemptInput(withDimension('RECALL'))).toThrow(/EXPOSURE/);
    expect(() => validateAttemptInput(withDimension(null))).toThrow(/EXPOSURE/);
    expect(() => validateAttemptInput(withDimension('EXPOSURE'))).not.toThrow();
  });
});

describe('exposure cannot leak into evidence', () => {
  it('no scored metric is ever tagged EXPOSURE, and the evidence dimensions exclude it', () => {
    expect(Object.values(METRIC_DIMENSIONS)).not.toContain('EXPOSURE');
    expect(EVIDENCE_DIMENSIONS).not.toContain('EXPOSURE');
    expect([...EVIDENCE_DIMENSIONS, 'EXPOSURE'].sort()).toEqual(Object.values(MeasurementDimension).sort());
  });

  it('generic scoring never produces an exposure or recall measurement from an exposure attempt', () => {
    const listen: AttemptInput = { ...base, surface: 'PODCAST_LISTEN', responseMode: 'NONE' };
    const ai = aiEvaluation({ outcome: { status: 'COMPLETED', questionAnswered: true, scores: { technicalAccuracy: 9 }, feedback: {} }, provider: 'p', model: 'm' });
    expect(() => validateAttemptInput({ ...listen, evaluations: [ai] })).toThrow(/EXPOSURE/);
  });
});

describe('sparse measurements', () => {
  it('writes a row only for what was measured', () => {
    const m = measurementsFromScores({ technicalAccuracy: 7.5, clarityScore: null, answerQuality: undefined });
    expect(m).toEqual([{ dimension: 'RECALL', metric: 'technicalAccuracy', value: 7.5, scaleMin: 0, scaleMax: 10 }]);
  });

  it('drops non-finite and out-of-scale values instead of storing them as evidence', () => {
    expect(measurementsFromScores({ clarityScore: Number.NaN, technicalAccuracy: 11, answerQuality: -1 })).toEqual([]);
  });

  it('tags only the metrics that can be defended and leaves the rest without a dimension', () => {
    expect(METRIC_DIMENSIONS).toMatchObject({
      technicalAccuracy: 'RECALL',
      clarityScore: 'EXPLANATION',
      confidenceScore: 'DELIVERY',
      intonationScore: 'DELIVERY',
      answerQuality: null,
      starScore: null,
      impactScore: null,
      terminologyUsage: null,
    });
  });
});

describe('evaluations keep what is needed to replay them', () => {
  it('records evaluator, rubric, prompt, provider, model, dimension map and time on the AI evaluation', () => {
    const e = aiEvaluation({
      outcome: { status: 'COMPLETED', questionAnswered: true, scores: { answerQuality: 8, technicalAccuracy: 7 }, feedback: { text: 'ok' } },
      provider: 'deepinfra',
      model: 'meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo',
    });
    expect(e).toMatchObject({
      kind: 'AI_RUBRIC',
      status: 'COMPLETED',
      evaluatorVersion: SPOKEN_ANSWER_EVALUATOR.evaluatorVersion,
      rubricVersion: SPOKEN_ANSWER_EVALUATOR.rubricVersion,
      promptVersion: SPOKEN_ANSWER_EVALUATOR.promptVersion,
      provider: 'deepinfra',
      model: 'meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo',
      dimensionMap: DIMENSION_MAP_VERSION,
    });
    expect(e.evaluatedAt).toBeInstanceOf(Date);
    expect(e.measurements.map((m) => m.metric)).toEqual(['answerQuality', 'technicalAccuracy']);
  });

  it('records delivery heuristics as their own versioned deterministic evaluation, or nothing', () => {
    expect(deliveryEvaluation({ confidenceScore: null, intonationScore: undefined })).toBeNull();
    const d = deliveryEvaluation({ confidenceScore: 6, intonationScore: 5.5 });
    expect(d).toMatchObject({ kind: 'DETERMINISTIC', status: 'COMPLETED', evaluatorVersion: DELIVERY_HEURISTICS_VERSION });
    expect(d?.measurements.every((m) => m.dimension === 'DELIVERY')).toBe(true);
  });

  it('a fallback is recorded as FAILED or SKIPPED with no measurements and its reason, never as scores', () => {
    for (const status of ['FAILED', 'SKIPPED'] as const) {
      const e = aiEvaluation({ outcome: { status, reason: 'why' }, provider: 'openai', model: 'gpt-4o-mini' });
      expect(e).toMatchObject({ status, failureReason: 'why', measurements: [] });
    }
  });

  it('refuses to attach measurements to a non-completed evaluation, or a failure with no reason', () => {
    const measured = { dimension: null, metric: 'answerQuality', value: 4 };
    const eval_ = { kind: 'AI_RUBRIC' as const, evaluatorVersion: 'v', measurements: [measured] };
    expect(() => validateAttemptInput({ ...base, evaluations: [{ ...eval_, status: 'FAILED', failureReason: 'x' }] })).toThrow(/cannot carry/);
    expect(() => validateAttemptInput({ ...base, evaluations: [{ ...eval_, status: 'FAILED', measurements: [] }] })).toThrow(/must say why/);
  });

  it('"current" is the latest completed evaluation per kind; failures never become current', () => {
    const t = (n: number) => new Date(2026, 0, n);
    const evals = [
      { id: 'old', kind: 'AI_RUBRIC', status: 'COMPLETED', evaluatedAt: t(1), recordedAt: t(1) },
      { id: 'new', kind: 'AI_RUBRIC', status: 'COMPLETED', evaluatedAt: t(3), recordedAt: t(3) },
      { id: 'failed', kind: 'AI_RUBRIC', status: 'FAILED', evaluatedAt: t(5), recordedAt: t(5) },
      { id: 'delivery', kind: 'DETERMINISTIC', status: 'COMPLETED', evaluatedAt: null, recordedAt: t(2) },
    ];
    expect(latestCompleted(evals).map((e) => e.id)).toEqual(['new', 'delivery']);
  });
});

describe('writing', () => {
  function fakeTx() {
    const calls: Array<[string, unknown]> = [];
    let n = 0;
    const tx = {
      attempt: {
        create: vi.fn(async (args: unknown) => (calls.push(['attempt.create', args]), { id: 'attempt-1' })),
        findUnique: vi.fn(async () => ({ surface: 'WRITTEN_TO_SPOKEN', learnerId: 'learner-1' })),
      },
      attemptEvaluation: {
        create: vi.fn(async (args: unknown) => (calls.push(['evaluation.create', args]), { id: `eval-${++n}` })),
      },
      attemptMeasurement: {
        createMany: vi.fn(async (args: unknown) => (calls.push(['measurement.createMany', args]), { count: 1 })),
      },
      syncChange: { create: vi.fn(async (args: unknown) => (calls.push(['syncChange.create', args]), { id: BigInt(1) })) },
    };
    return { tx: tx as never, calls, raw: tx };
  }

  it('creates the attempt with its evidence, then each evaluation with its measurements', async () => {
    const { tx, calls } = fakeTx();
    const result = await recordAttempt(tx, {
      ...base,
      evidence: { transcript: 'hello', words: 1 },
      evaluations: [
        aiEvaluation({
          outcome: { status: 'COMPLETED', questionAnswered: true, scores: { answerQuality: 8 }, feedback: {} },
          provider: 'openai',
          model: 'gpt-4o-mini',
        }),
      ],
    });
    expect(result).toEqual({ attemptId: 'attempt-1', evaluationIds: ['eval-1'] });
    // the pull feed is told about the attempt in the same transaction
    expect(calls.map((c) => c[0])).toEqual(['attempt.create', 'evaluation.create', 'measurement.createMany', 'syncChange.create']);
    expect(calls[0][1]).toMatchObject({
      data: { learnerId: 'learner-1', questionId: 'q1', promptSnapshot: 'Explain the event loop.', evidence: { create: { transcript: 'hello' } } },
    });
    expect(calls[2][1]).toMatchObject({ data: [{ evaluationId: 'eval-1', attemptId: 'attempt-1', metric: 'answerQuality', value: 8 }] });
  });

  it('writes no measurement rows for a failed evaluation', async () => {
    const { tx, raw } = fakeTx();
    await recordAttempt(tx, {
      ...base,
      evaluations: [aiEvaluation({ outcome: { status: 'FAILED', reason: 'timeout' }, provider: 'openai', model: 'm' })],
    });
    expect(raw.attemptMeasurement.createMany).not.toHaveBeenCalled();
  });

  it('re-evaluation appends and never touches the attempt or earlier evaluations', async () => {
    const { tx, raw } = fakeTx();
    const ids = await appendEvaluation(tx, 'attempt-1', [
      aiEvaluation({ outcome: { status: 'COMPLETED', questionAnswered: true, scores: { answerQuality: 9 }, feedback: {} }, provider: 'openai', model: 'm' }),
    ]);
    expect(ids).toEqual(['eval-1']);
    expect(raw.attemptEvaluation.create).toHaveBeenCalledTimes(1);
    expect(raw.attempt.create).not.toHaveBeenCalled();
  });
});
