/**
 * Question order for a practice session. Stable across refetches so an interrupted session
 * resumes with the same questions: answers given in this session are pinned first, and the
 * rest are ranked as of the moment the session was created.
 */

import type { LearningContext } from "./learning-context";
import { selectQuestions, type Candidate, type ProgressRecord } from "./question-selection";

export interface SessionQuestion extends Candidate {
	hint?: string | null;
	type?: string | null;
}

export interface OrderInput<Q extends SessionQuestion> {
	questions: readonly Q[];
	/** Question ids answered in this session, in the order first answered. */
	answeredInSession: readonly string[];
	progress: ReadonlyMap<string, ProgressRecord>;
	sessionCreatedAt: Date;
	maxQuestions?: number;
	/** When omitted, only administrative questions are removed (no context assumption). */
	activeContext?: LearningContext;
	interviewTerms?: readonly string[];
	roleTerms?: readonly string[];
	recentQuestionIds?: readonly string[];
}

export function orderSessionQuestions<Q extends SessionQuestion>(input: OrderInput<Q>): Q[] {
	const byId = new Map(input.questions.map((q) => [q.id, q]));
	const pinned = [...new Set(input.answeredInSession)]
		.map((id) => byId.get(id))
		.filter((q): q is Q => !!q);
	const pinnedIds = new Set(pinned.map((q) => q.id));

	const limit = input.maxQuestions && input.maxQuestions > 0 ? input.maxQuestions : input.questions.length;
	const room = Math.max(0, limit - pinned.length);

	// Progress as it was before this session: ignore rows for pinned questions.
	const progress = new Map([...input.progress].filter(([id]) => !pinnedIds.has(id)));
	const ranked = selectQuestions(
		input.questions.filter((q) => !pinnedIds.has(q.id)),
		progress,
		{
			now: input.sessionCreatedAt,
			count: room,
			// Every context allows unclassified material; an unspecified context accepts them all.
			activeContext: input.activeContext ?? "INTERVIEW",
			interviewTerms: input.interviewTerms,
			roleTerms: input.roleTerms,
			recentQuestionIds: input.recentQuestionIds,
			allowRepeats: false,
		},
	).map((s) => s.question);

	// Never return an empty session just because everything was recently practised:
	// fall back to the least-recent questions rather than nothing.
	if (ranked.length < room) {
		const have = new Set([...pinnedIds, ...ranked.map((q) => q.id)]);
		const filler = selectQuestions(
			input.questions.filter((q) => !have.has(q.id)),
			progress,
			{ now: input.sessionCreatedAt, count: room - ranked.length, activeContext: input.activeContext ?? "INTERVIEW", allowRepeats: true },
		).map((s) => s.question);
		ranked.push(...filler);
	}
	return [...pinned, ...ranked];
}
