/**
 * The canonical attempt ledger: what a learner did, what they produced, and what evaluators made of it.
 *
 *   "Listening is exposure. Retrieval is evidence. Performance is stronger evidence."
 *
 * Pure builders and validators live here so they are unit tested without a database; `recordAttempt` and
 * `appendEvaluation` write inside a caller-supplied transaction. The ledger tables are append-only (database
 * triggers); re-evaluating an answer appends a new evaluation, it never edits an old one.
 */
import type {
  AttemptSurface,
  EvaluationStatus,
  EvaluatorKind,
  MeasurementDimension,
  Prisma,
  ResponseMode,
} from '@prisma/client';

// ---- versions: bump when the thing they name changes, never edit history ------------------------------------

/** Version of the metric -> dimension tagging below. Retained on every evaluation that used it. */
export const DIMENSION_MAP_VERSION = 'dimensions@1';

/** The AI spoken-answer evaluator. rubricVersion and promptVersion change independently of the code. */
export const SPOKEN_ANSWER_EVALUATOR = {
  evaluatorVersion: 'spoken-answer@1',
  rubricVersion: 'spoken-answer-rubric@1',
  promptVersion: 'spoken-answer-prompt@1',
} as const;

/** The code that turns a transcript into confidence and intonation scores. */
export const DELIVERY_HEURISTICS_VERSION = 'delivery-heuristics@1';

/**
 * The dimensions that count as evidence of retrieval or performance. EXPOSURE is deliberately absent: being shown
 * something never counts as having demonstrated it. Any aggregate that asks "what has the learner demonstrated"
 * must filter on this list, not on "every dimension".
 */
export const EVIDENCE_DIMENSIONS = ['RECALL', 'EXPLANATION', 'APPLICATION', 'DELIVERY', 'DISCRIMINATION'] as const;

/**
 * dimensions@1. Only what can be defended is tagged; everything else has no dimension rather than a guess.
 *   technicalAccuracy -> RECALL       (was the retrieved content right)
 *   clarityScore      -> EXPLANATION  (was it explained clearly)
 *   confidence, intonation -> DELIVERY
 * Composite and rubric-specific numbers (answerQuality, STAR, specificity, terminology) are untagged.
 * The same table is applied to historical rows by the P1 migration; the integration test keeps them equal.
 */
export const METRIC_DIMENSIONS: Readonly<Record<string, MeasurementDimension | null>> = {
  answerQuality: null,
  starScore: null,
  impactScore: null,
  clarityScore: 'EXPLANATION',
  technicalAccuracy: 'RECALL',
  terminologyUsage: null,
  confidenceScore: 'DELIVERY',
  intonationScore: 'DELIVERY',
};

// ---- inputs -------------------------------------------------------------------------------------------------

export interface MeasurementInput {
  dimension: MeasurementDimension | null;
  metric: string;
  value: number;
  scaleMin?: number;
  scaleMax?: number;
}

export interface EvaluationInput {
  kind: EvaluatorKind;
  status: EvaluationStatus;
  evaluatorVersion: string;
  rubricVersion?: string | null;
  promptVersion?: string | null;
  provider?: string | null;
  model?: string | null;
  failureReason?: string | null;
  questionAnswered?: boolean | null;
  feedback?: Prisma.InputJsonValue | null;
  dimensionMap?: string | null;
  /** The text the evaluator saw, only when it differs from the recorded evidence (a corrected transcript). */
  evaluatedText?: string | null;
  evaluatedAt?: Date | null;
  measurements: MeasurementInput[];
}

export interface EvidenceInput {
  responseText?: string | null;
  transcript?: string | null;
  audioRef?: string | null;
  transcriber?: string | null;
  words?: number | null;
  wpm?: number | null;
  fillerCount?: number | null;
  fillerRate?: number | null;
  longPauses?: number | null;
}

export interface AttemptInput {
  learnerId: string;
  actorPrincipalId?: string | null;
  goalId?: string | null;
  surface: AttemptSurface;
  responseMode: ResponseMode;
  source: string;
  legacyRef?: string | null;
  occurredAt?: Date;
  hintUsed?: boolean | null;
  sessionId?: string | null;
  /** The prompt as the learner saw it, plus where it came from. */
  prompt: {
    questionId?: string | null;
    text: string;
    type?: string | null;
    tags?: string[];
    bankId?: string | null;
  };
  evidence?: EvidenceInput | null;
  evaluations: EvaluationInput[];
}

export class LedgerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerInputError';
  }
}

// ---- measurement helpers --------------------------------------------------------------------------------------

/**
 * Sparse measurements from a score set: a missing, null or non-finite score yields no row (absence stays
 * absence), and so does a score outside its scale (it is not evidence of anything).
 */
export function measurementsFromScores(
  scores: Readonly<Record<string, number | null | undefined>>,
  scale: { min: number; max: number } = { min: 0, max: 10 }
): MeasurementInput[] {
  const out: MeasurementInput[] = [];
  for (const [metric, value] of Object.entries(scores)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (value < scale.min || value > scale.max) continue;
    out.push({
      dimension: METRIC_DIMENSIONS[metric] ?? null,
      metric,
      value,
      scaleMin: scale.min,
      scaleMax: scale.max,
    });
  }
  return out;
}

export interface FeedbackParts {
  whatWasRight?: string[];
  whatWasWrong?: string[];
  betterWording?: string[];
  dontForget?: string[];
  text?: string | null;
}

/**
 * The AI evaluation of a spoken or typed answer. A fallback (the evaluator did not run) is recorded as FAILED or
 * SKIPPED with no measurements: canned numbers are never stored as scores.
 */
export function aiEvaluation(args: {
  outcome:
    | { status: 'COMPLETED'; questionAnswered: boolean | null; scores: Record<string, number | null | undefined>; feedback: FeedbackParts }
    | { status: 'FAILED' | 'SKIPPED'; reason: string };
  provider: string;
  model: string;
  evaluatedAt?: Date;
}): EvaluationInput {
  const base = {
    kind: 'AI_RUBRIC' as const,
    ...SPOKEN_ANSWER_EVALUATOR,
    provider: args.provider,
    model: args.model,
    dimensionMap: DIMENSION_MAP_VERSION,
    evaluatedAt: args.evaluatedAt ?? new Date(),
  };
  if (args.outcome.status === 'COMPLETED') {
    // answerQuality is the composite; the rubric scores follow. Delivery scores are a separate evaluation.
    return {
      ...base,
      status: 'COMPLETED',
      questionAnswered: args.outcome.questionAnswered,
      feedback: args.outcome.feedback as Prisma.InputJsonValue,
      measurements: measurementsFromScores(args.outcome.scores),
    };
  }
  return { ...base, status: args.outcome.status, failureReason: args.outcome.reason, measurements: [] };
}

/** The transcript-derived delivery heuristics as their own evaluation (valid even when the AI step failed). */
export function deliveryEvaluation(scores: { confidenceScore?: number | null; intonationScore?: number | null }): EvaluationInput | null {
  const measurements = measurementsFromScores({
    confidenceScore: scores.confidenceScore,
    intonationScore: scores.intonationScore,
  });
  if (measurements.length === 0) return null;
  return {
    kind: 'DETERMINISTIC',
    status: 'COMPLETED',
    evaluatorVersion: DELIVERY_HEURISTICS_VERSION,
    dimensionMap: DIMENSION_MAP_VERSION,
    evaluatedAt: new Date(),
    measurements,
  };
}

// ---- validation ---------------------------------------------------------------------------------------------

/** Rules the database also enforces, checked first so the caller gets a clear error instead of a trigger error. */
export function validateAttemptInput(input: AttemptInput): void {
  const exposureOnly = input.surface === 'PODCAST_LISTEN';
  if (exposureOnly !== (input.responseMode === 'NONE')) {
    throw new LedgerInputError('A listen-only attempt has no response, and every other attempt has one.');
  }
  if (!input.prompt.text.trim()) throw new LedgerInputError('An attempt needs the prompt text it was given.');
  for (const e of input.evaluations) {
    if (e.status !== 'COMPLETED' && e.measurements.length > 0) {
      throw new LedgerInputError(`A ${e.status} evaluation cannot carry measurements.`);
    }
    if (e.status === 'FAILED' && !e.failureReason) {
      throw new LedgerInputError('A FAILED evaluation must say why.');
    }
    for (const m of e.measurements) {
      const min = m.scaleMin ?? 0;
      const max = m.scaleMax ?? 10;
      if (!(max > min) || !Number.isFinite(m.value) || m.value < min || m.value > max) {
        throw new LedgerInputError(`Measurement ${m.metric} is outside its scale.`);
      }
      if (exposureOnly && m.dimension !== 'EXPOSURE') {
        throw new LedgerInputError('Listening is exposure: a listen-only attempt can only carry EXPOSURE measurements.');
      }
    }
  }
}

// ---- writing ------------------------------------------------------------------------------------------------

async function insertEvaluation(
  tx: Prisma.TransactionClient,
  attemptId: string,
  e: EvaluationInput
): Promise<string> {
  const evaluation = await tx.attemptEvaluation.create({
    data: {
      attemptId,
      kind: e.kind,
      status: e.status,
      evaluatorVersion: e.evaluatorVersion,
      rubricVersion: e.rubricVersion ?? null,
      promptVersion: e.promptVersion ?? null,
      provider: e.provider ?? null,
      model: e.model ?? null,
      failureReason: e.failureReason ?? null,
      questionAnswered: e.questionAnswered ?? null,
      feedback: e.feedback ?? undefined,
      dimensionMap: e.dimensionMap ?? null,
      evaluatedText: e.evaluatedText ?? null,
      evaluatedAt: e.evaluatedAt ?? null,
    },
    select: { id: true },
  });
  if (e.measurements.length > 0) {
    await tx.attemptMeasurement.createMany({
      data: e.measurements.map((m) => ({
        evaluationId: evaluation.id,
        attemptId,
        dimension: m.dimension,
        metric: m.metric,
        value: m.value,
        scaleMin: m.scaleMin ?? 0,
        scaleMax: m.scaleMax ?? 10,
      })),
    });
  }
  return evaluation.id;
}

/** Record one attempt with its evidence and evaluations. Call inside a transaction. */
export async function recordAttempt(
  tx: Prisma.TransactionClient,
  input: AttemptInput
): Promise<{ attemptId: string; evaluationIds: string[] }> {
  validateAttemptInput(input);
  const attempt = await tx.attempt.create({
    data: {
      learnerId: input.learnerId,
      actorPrincipalId: input.actorPrincipalId ?? null,
      goalId: input.goalId ?? null,
      surface: input.surface,
      responseMode: input.responseMode,
      source: input.source,
      legacyRef: input.legacyRef ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      hintUsed: input.hintUsed ?? null,
      sessionId: input.sessionId ?? null,
      questionId: input.prompt.questionId ?? null,
      promptSnapshot: input.prompt.text,
      questionType: input.prompt.type ?? null,
      tagsSnapshot: input.prompt.tags ?? [],
      bankId: input.prompt.bankId ?? null,
      ...(input.evidence
        ? {
            evidence: {
              create: {
                responseText: input.evidence.responseText ?? null,
                transcript: input.evidence.transcript ?? null,
                audioRef: input.evidence.audioRef ?? null,
                transcriber: input.evidence.transcriber ?? null,
                words: input.evidence.words ?? null,
                wpm: input.evidence.wpm ?? null,
                fillerCount: input.evidence.fillerCount ?? null,
                fillerRate: input.evidence.fillerRate ?? null,
                longPauses: input.evidence.longPauses ?? null,
              },
            },
          }
        : {}),
    },
    select: { id: true },
  });
  const evaluationIds: string[] = [];
  for (const e of input.evaluations) evaluationIds.push(await insertEvaluation(tx, attempt.id, e));
  return { attemptId: attempt.id, evaluationIds };
}

/** Re-evaluation of an existing attempt: appends, never edits. */
export async function appendEvaluation(
  tx: Prisma.TransactionClient,
  attemptId: string,
  evaluations: EvaluationInput[]
): Promise<string[]> {
  const found = await tx.attempt.findUnique({ where: { id: attemptId }, select: { surface: true } });
  if (!found) throw new LedgerInputError('Cannot evaluate an attempt that does not exist.');
  const ids: string[] = [];
  for (const e of evaluations) {
    if (found.surface === 'PODCAST_LISTEN' && e.measurements.some((m) => m.dimension !== 'EXPOSURE')) {
      throw new LedgerInputError('Listening is exposure: a listen-only attempt can only carry EXPOSURE measurements.');
    }
    ids.push(await insertEvaluation(tx, attemptId, e));
  }
  return ids;
}

/** The scores of the latest COMPLETED evaluation per kind, newest first. What "current" means for an attempt. */
export function latestCompleted<T extends { kind: string; status: string; evaluatedAt: Date | null; recordedAt: Date }>(
  evaluations: T[]
): T[] {
  const byKind = new Map<string, T>();
  const when = (e: T) => (e.evaluatedAt ?? e.recordedAt).getTime();
  for (const e of evaluations) {
    if (e.status !== 'COMPLETED') continue;
    const current = byKind.get(e.kind);
    if (!current || when(e) > when(current)) byKind.set(e.kind, e);
  }
  return [...byKind.values()].sort((a, b) => when(b) - when(a));
}
