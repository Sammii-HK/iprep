/**
 * Learning-value question selection (Tranche A/B). Pure and deterministic: no database,
 * no randomness. Ranks candidates by what is most useful to practise now and explains why.
 */

import {
	filterQuestionsForPractice,
	type FilterableQuestion,
	type LearningContext,
} from "./learning-context";

const DAY = 86_400_000;

export interface Candidate extends FilterableQuestion {
	bankId: string;
	difficulty?: number;
	/** Optional shared concept id; two questions with the same one are treated as duplicates. */
	conceptKey?: string | null;
}

export interface ProgressRecord {
	nextReviewAt: Date;
	lastPracticed: Date;
	/** 0-10, from a completed evaluation only; null when the last evaluation failed. */
	lastScore: number | null;
	repetitions: number;
}

export interface SelectionOptions {
	now: Date;
	count: number;
	activeContext: LearningContext;
	/** Learner's explicit selection. Empty means "no preference", not "everything excluded". */
	selectedBankIds?: readonly string[];
	bankTitles?: Readonly<Record<string, string>>;
	/** Terms from the upcoming interview/role (title, company, skills), lowercase. */
	interviewTerms?: readonly string[];
	roleTerms?: readonly string[];
	/** Questions already asked in recent sessions or in the current one. */
	recentQuestionIds?: readonly string[];
	/** Mistakes loop / explicit repetition: allow recently practised questions. */
	allowRepeats?: boolean;
	includeAdministrative?: boolean;
}

export interface Selected<Q extends Candidate> {
	question: Q;
	score: number;
	reasons: string[];
}

const normalise = (t: string) =>
	new Set(
		t
			.toLowerCase()
			.replace(/[^\w\s]/g, " ")
			.split(/\s+/)
			.filter((w) => w.length > 3),
	);

function similar(a: Set<string>, b: Set<string>): boolean {
	if (a.size === 0 || b.size === 0) return false;
	let shared = 0;
	for (const w of a) if (b.has(w)) shared++;
	return shared / (a.size + b.size - shared) >= 0.7;
}

const mentions = (text: string, tags: readonly string[], terms: readonly string[]) => {
	const hay = `${text} ${tags.join(" ")}`.toLowerCase();
	return terms.some((t) => t && hay.includes(t.toLowerCase()));
};

export function selectQuestions<Q extends Candidate>(
	candidates: readonly Q[],
	progress: ReadonlyMap<string, ProgressRecord>,
	options: SelectionOptions,
): Selected<Q>[] {
	const {
		now,
		count,
		selectedBankIds = [],
		interviewTerms = [],
		roleTerms = [],
		bankTitles = {},
	} = options;
	const recent = new Set(options.recentQuestionIds ?? []);
	const explicit = new Set(selectedBankIds);

	// Context + administrative gating, per question (a mixed bank cannot leak).
	const eligible = candidates.filter((q) => explicit.size === 0 || explicit.has(q.bankId));
	const gated = new Set(
		filterQuestionsForPractice(eligible, {
			activeContext: options.activeContext,
			includeAdministrative: options.includeAdministrative,
		}).map((q) => q.id),
	);

	const scored: Selected<Q>[] = [];
	for (const q of eligible) {
		if (!gated.has(q.id)) continue;
		const p = progress.get(q.id);
		const reasons: string[] = [];
		let score = 0;

		if (!p) {
			score += 50;
			reasons.push("New question");
		} else {
			const due = p.nextReviewAt.getTime() <= now.getTime();
			const sinceDays = (now.getTime() - p.lastPracticed.getTime()) / DAY;
			const weak = p.lastScore !== null && p.lastScore < 6;
			score += 5; // seen before: eligible as filler, ranked below new/due/weak
			if (due) {
				const overdue = Math.min(10, (now.getTime() - p.nextReviewAt.getTime()) / DAY);
				score += 60 + overdue * 2;
				reasons.push("Due for review");
			}
			if (weak) {
				score += 30;
				reasons.push("Previously difficult");
			}
			if (!due && !weak && sinceDays > 14) {
				score += Math.min(20, sinceDays / 3);
				reasons.push("Not practised recently");
			}
			// Answered within the day and neither due nor weak: don't repeat unless asked.
			if (sinceDays < 1 && !due && !weak && !options.allowRepeats) score -= 1000;
		}

		if (recent.has(q.id) && !options.allowRepeats) score -= 1000;
		const tags = q.tags ?? [];
		if (interviewTerms.length && mentions(q.text, tags, interviewTerms)) {
			score += 25;
			reasons.push("Relevant to your upcoming interview");
		}
		if (roleTerms.length && mentions(q.text, tags, roleTerms)) {
			score += 15;
			reasons.push("Relevant to your target role");
		}
		if (explicit.has(q.bankId)) score += 10;
		if (score <= 0) continue;
		scored.push({ question: q, score, reasons });
	}

	// Highest value first; stable tie-break by id so results are deterministic.
	scored.sort((a, b) => b.score - a.score || a.question.id.localeCompare(b.question.id));

	// Greedy pick: skip duplicates/near-duplicates, and gently interleave banks.
	const picked: Selected<Q>[] = [];
	const sigs: Set<string>[] = [];
	const perBank = new Map<string, number>();
	const remaining = [...scored];
	while (picked.length < count && remaining.length) {
		let bestIdx = -1;
		let bestAdj = -Infinity;
		for (let i = 0; i < remaining.length; i++) {
			const r = remaining[i];
			const adj = r.score - (perBank.get(r.question.bankId) ?? 0) * 8;
			if (adj > bestAdj) {
				bestAdj = adj;
				bestIdx = i;
			}
		}
		const [next] = remaining.splice(bestIdx, 1);
		const sig = normalise(next.question.text);
		const dupe =
			picked.some(
				(p) => next.question.conceptKey && p.question.conceptKey === next.question.conceptKey,
			) || sigs.some((s) => similar(s, sig));
		if (dupe) continue;
		picked.push(next);
		sigs.push(sig);
		perBank.set(next.question.bankId, (perBank.get(next.question.bankId) ?? 0) + 1);
	}
	void bankTitles;
	return picked;
}
