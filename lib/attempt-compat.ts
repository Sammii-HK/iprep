/**
 * Compatibility layer: the existing practice and quiz flows keep their tables and their UI, and also write the
 * canonical Attempt.
 *
 * Canonical source: the Attempt ledger, for everything recorded from the P1 deploy onward. The legacy columns
 * (SessionItem scores, QuizAttempt.score) are a projection kept for the current UI; nothing reads the ledger for
 * display yet.
 *
 * Writes are one transaction (Attempt, evidence and evaluations, then the legacy row carrying `attemptId`).
 * If the canonical write fails the request fails and neither representation commits: from the P1 deploy onward a
 * successful learning event always has canonical evidence. There is no legacy-only fallback and no split-brain
 * state. `scripts/ledger-check.ts` detects corruption and historical gaps; it is not a recovery mechanism.
 *
 * Deploy order follows from that: the migration is applied before the code that writes the ledger.
 *
 * Removal: the dual write and the legacy score columns go once reads move to the ledger (not in P1). Until then
 * both exist on purpose.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { chatModelInfo, transcriptionModelInfo } from './ai-models';
import {
  type EvaluationInput,
  LedgerInputError,
  type FeedbackParts,
  aiEvaluation,
  appendEvaluation,
  deliveryEvaluation,
  recordAttempt,
} from './attempts';
import { ensureLearner } from './learner';

export type AnalysisProvenance =
  | { status: 'COMPLETED' }
  | { status: 'FAILED' | 'SKIPPED'; reason: string };

export interface AnalysisScores {
  answerQuality?: number | null;
  starScore?: number | null;
  impactScore?: number | null;
  clarityScore?: number | null;
  technicalAccuracy?: number | null;
  terminologyUsage?: number | null;
}

export interface PracticeEvidence {
  transcript: string;
  audioRef: string | null;
  words: number | null;
  wpm: number | null;
  fillerCount: number | null;
  fillerRate: number | null;
  longPauses: number | null;
}

export interface PracticeCanonical {
  userId: string;
  /** Set when a machine principal recorded the answer for the learner. */
  principalId?: string | null;
  question: { id: string; text: string; type?: string | null; tags: string[]; bankId: string | null };
  sessionId: string;
  evidence: PracticeEvidence;
  provenance: AnalysisProvenance;
  questionAnswered: boolean | null;
  scores: AnalysisScores;
  feedback: FeedbackParts;
  confidenceScore: number | null;
  intonationScore: number | null;
}

/** The AI evaluation plus the delivery heuristics for one spoken answer. */
export function spokenAnswerEvaluations(c: {
  provenance: AnalysisProvenance;
  questionAnswered: boolean | null;
  scores: AnalysisScores;
  feedback: FeedbackParts;
  confidenceScore: number | null;
  intonationScore: number | null;
  evaluatedText?: string | null;
}): EvaluationInput[] {
  const model = chatModelInfo();
  const ai = aiEvaluation({
    outcome:
      c.provenance.status === 'COMPLETED'
        ? { status: 'COMPLETED', questionAnswered: c.questionAnswered, scores: { ...c.scores }, feedback: c.feedback }
        : { status: c.provenance.status, reason: c.provenance.reason },
    provider: model.provider,
    model: model.model,
  });
  if (c.evaluatedText) ai.evaluatedText = c.evaluatedText;
  const delivery = deliveryEvaluation({ confidenceScore: c.confidenceScore, intonationScore: c.intonationScore });
  return delivery ? [ai, delivery] : [ai];
}

/**
 * Save one practice answer. Returns the legacy SessionItem and, when the ledger write succeeded, the canonical
 * attempt id.
 */
export async function persistPracticeAnswer(
  db: PrismaClient,
  legacy: Prisma.SessionItemUncheckedCreateInput,
  canonical: PracticeCanonical
): Promise<{ sessionItemId: string; attemptId: string }> {
  return db.$transaction(async (tx) => {
    const learner = await ensureLearner(canonical.userId, tx);
    const transcriber = transcriptionModelInfo();
    const { attemptId } = await recordAttempt(tx, {
      learnerId: learner.id,
      actorPrincipalId: canonical.principalId ?? null,
      surface: 'WRITTEN_TO_SPOKEN',
      responseMode: 'SPOKEN',
      source: 'practice-api',
      sessionId: canonical.sessionId,
      prompt: {
        questionId: canonical.question.id,
        text: canonical.question.text,
        type: canonical.question.type ?? null,
        tags: canonical.question.tags,
        bankId: canonical.question.bankId,
      },
      evidence: {
        transcript: canonical.evidence.transcript,
        audioRef: canonical.evidence.audioRef,
        transcriber: `${transcriber.provider}/${transcriber.model}`,
        words: canonical.evidence.words,
        wpm: canonical.evidence.wpm,
        fillerCount: canonical.evidence.fillerCount,
        fillerRate: canonical.evidence.fillerRate,
        longPauses: canonical.evidence.longPauses,
      },
      evaluations: spokenAnswerEvaluations(canonical),
    });
    const item = await tx.sessionItem.create({ data: { ...legacy, attemptId }, select: { id: true } });
    return { sessionItemId: item.id, attemptId };
  });
}

/**
 * Re-analysis of an answer (the learner corrected the transcript). One transaction appends a new evaluation to the
 * attempt (evidence and earlier evaluations are never edited) and, only when the evaluation actually completed,
 * updates the legacy projection.
 *
 * When the evaluator fails: a FAILED evaluation is appended (so the failed attempt to evaluate is on record, with
 * the corrected text), and the legacy row is left exactly as it was. Canned numbers are never written, so the
 * learner keeps their previous legitimate evaluation. An answer with no canonical attempt cannot be re-analysed.
 */
export async function applyReanalysis(
  db: PrismaClient,
  args: {
    attemptId: string | null;
    sessionItemId: string;
    legacyUpdate: Prisma.SessionItemUncheckedUpdateInput;
    recordedTranscript: string | null;
    correctedTranscript: string;
    provenance: AnalysisProvenance;
    questionAnswered: boolean | null;
    scores: AnalysisScores;
    feedback: FeedbackParts;
    confidenceScore: number | null;
    intonationScore: number | null;
  }
): Promise<void> {
  if (!args.attemptId) throw new LedgerInputError('This answer has no canonical attempt and cannot be re-analysed.');
  const attemptId = args.attemptId;
  await db.$transaction(async (tx) => {
    await appendEvaluation(
      tx,
      attemptId,
      spokenAnswerEvaluations({
        ...args,
        evaluatedText: args.correctedTranscript !== args.recordedTranscript ? args.correctedTranscript : null,
      })
    );
    if (args.provenance.status === 'COMPLETED') {
      await tx.sessionItem.update({ where: { id: args.sessionItemId }, data: args.legacyUpdate });
    }
  });
}

export interface QuizCanonical {
  userId: string;
  principalId?: string | null;
  /** SPOKEN quizzes are spoken answers to a written prompt; WRITTEN quizzes are typed retrieval. */
  mode: 'SPOKEN' | 'TYPED';
  question: { id: string; text: string; type?: string | null; tags: string[]; bankId: string | null };
  hintUsed: boolean;
  evidence: {
    responseText: string | null;
    transcript: string | null;
    audioRef: string | null;
    words: number | null;
    wpm: number | null;
    fillerCount: number | null;
    fillerRate: number | null;
    longPauses: number | null;
  };
  provenance: AnalysisProvenance;
  questionAnswered: boolean | null;
  scores: AnalysisScores;
  feedback: FeedbackParts;
  /** Only spoken answers have delivery heuristics. */
  confidenceScore: number | null;
  intonationScore: number | null;
}

/**
 * Save one quiz answer: the legacy QuizAttempt and the canonical Attempt, in one transaction. QuizAttempt has no
 * foreign key to the ledger; the pairing is the Attempt's `legacyRef` ("QuizAttempt:<id>").
 */
export async function persistQuizAttempt(
  db: PrismaClient,
  legacy: Prisma.QuizAttemptUncheckedCreateInput,
  canonical: QuizCanonical
): Promise<{ quizAttemptId: string; attemptId: string }> {
  return db.$transaction(async (tx) => {
      const learner = await ensureLearner(canonical.userId, tx);
      const row = await tx.quizAttempt.create({ data: legacy, select: { id: true } });
      const spoken = canonical.mode === 'SPOKEN';
      const transcriber = transcriptionModelInfo();
      const { attemptId } = await recordAttempt(tx, {
        learnerId: learner.id,
        actorPrincipalId: canonical.principalId ?? null,
        surface: spoken ? 'WRITTEN_TO_SPOKEN' : 'TYPED_RETRIEVAL',
        responseMode: spoken ? 'SPOKEN' : 'TYPED',
        source: 'quiz-api',
        legacyRef: `QuizAttempt:${row.id}`,
        hintUsed: canonical.hintUsed,
        prompt: {
          questionId: canonical.question.id,
          text: canonical.question.text,
          type: canonical.question.type ?? null,
          tags: canonical.question.tags,
          bankId: canonical.question.bankId,
        },
        evidence: {
          ...canonical.evidence,
          transcriber: spoken && canonical.evidence.transcript ? `${transcriber.provider}/${transcriber.model}` : null,
        },
        evaluations: spokenAnswerEvaluations(canonical),
      });
      return { quizAttemptId: row.id, attemptId };
  });
}
