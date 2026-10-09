/**
 * Structured answer analysis and the fairness checks around it. The evaluator's output is
 * validated here: a failed evaluation yields no scores, and every criticism must be grounded
 * in the transcript or be an explicit omission against the rubric.
 */

import { z } from "zod";

const Grounded = z.object({
	concept: z.string().min(1),
	/** Verbatim excerpt from the transcript that supports the claim. */
	evidence: z.string().min(1),
});

export const AnswerAnalysisSchema = z.object({
	rubricVersion: z.string(),
	demonstrated: z.array(Grounded),
	/** Mentioned by name but not explained. Never counted as understanding. */
	mentionedOnly: z.array(Grounded),
	/** Required by the rubric and absent. No transcript evidence by definition. */
	missing: z.array(z.object({ concept: z.string(), criterionId: z.string(), core: z.boolean() })),
	misconceptions: z.array(
		Grounded.extend({ correction: z.string().min(1) }),
	),
	/** Optional extensions. Explicitly NOT mistakes. */
	deepen: z.array(z.string()),
	strength: Grounded.nullable(),
	nextStep: z.string().nullable(),
	followUp: z
		.object({ question: z.string(), targetsConcept: z.string() })
		.nullable(),
});
export type AnswerAnalysis = z.infer<typeof AnswerAnalysisSchema>;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s]/g, "").trim();

/** Evidence must actually occur in the transcript (whitespace/punctuation-insensitive). */
export function isGrounded(evidence: string, transcript: string): boolean {
	const e = norm(evidence);
	return e.length > 0 && norm(transcript).includes(e);
}

export interface ValidatedAnalysis {
	analysis: AnswerAnalysis;
	/** Items dropped because their quoted evidence is not in the transcript. */
	ungrounded: string[];
}

/** Drops fabricated claims instead of showing them. Keeps everything that is supported. */
export function groundAnalysis(a: AnswerAnalysis, transcript: string): ValidatedAnalysis {
	const ungrounded: string[] = [];
	const keep = <T extends { concept: string; evidence: string }>(items: T[]) =>
		items.filter((i) => {
			const ok = isGrounded(i.evidence, transcript);
			if (!ok) ungrounded.push(i.concept);
			return ok;
		});
	const strength = a.strength && isGrounded(a.strength.evidence, transcript) ? a.strength : null;
	if (a.strength && !strength) ungrounded.push(a.strength.concept);
	return {
		analysis: {
			...a,
			demonstrated: keep(a.demonstrated),
			mentionedOnly: keep(a.mentionedOnly),
			misconceptions: keep(a.misconceptions),
			strength,
		},
		ungrounded,
	};
}

export interface FeedbackView {
	demonstrated: string[];
	couldBeStronger: string[];
	saidWell: string | null;
	tryNext: string | null;
	followUp: { question: string; targetsConcept: string } | null;
}

/**
 * The learner-facing summary: what you demonstrated, the two or three highest-value
 * improvements (misconceptions first, then missing core concepts), and one next step.
 * Optional depth is never listed as a mistake.
 */
export function buildFeedback(a: AnswerAnalysis, maxImprovements = 3): FeedbackView {
	const improvements = [
		...a.misconceptions.map((m) => `Check: ${m.concept} — ${m.correction}`),
		...a.missing.filter((m) => m.core).map((m) => `Cover ${m.concept}`),
		...a.mentionedOnly.map((m) => `Explain ${m.concept}, not just name it`),
		...a.deepen,
	].slice(0, maxImprovements);
	return {
		demonstrated: a.demonstrated.map((d) => d.concept),
		couldBeStronger: improvements,
		saidWell: a.strength ? `You explained ${a.strength.concept} clearly.` : null,
		tryNext: a.nextStep ?? improvements[0] ?? null,
		followUp: a.followUp,
	};
}

export type EvaluationOutcome =
	| { status: "COMPLETED"; analysis: AnswerAnalysis; score: number }
	| { status: "FAILED"; reason: string };

/**
 * Turns an evaluator response into an outcome. Any failure — transport error, invalid
 * shape, non-finite score — is FAILED with NO score, so it can never become demonstrated
 * ability.
 */
export function finaliseEvaluation(
	raw: unknown,
	score: unknown,
	transcript: string,
): EvaluationOutcome {
	const parsed = AnswerAnalysisSchema.safeParse(raw);
	if (!parsed.success) return { status: "FAILED", reason: "Evaluator returned an invalid analysis" };
	if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 10) {
		return { status: "FAILED", reason: "Evaluator returned no valid score" };
	}
	return { status: "COMPLETED", analysis: groundAnalysis(parsed.data, transcript).analysis, score };
}
