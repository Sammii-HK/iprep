/**
 * Learning contexts and question-purpose heuristics (Tranche A).
 *
 * Pure and side-effect free: nothing here reads or writes the database. Contexts are
 * inferred from titles, tags and text so existing banks work without a migration; an
 * explicit override always wins over inference.
 */

export const LEARNING_CONTEXTS = [
	"INTERVIEW",
	"TECHNICAL_LEARNING",
	"FOUNDER",
	"FUNDRAISING",
	"GENERAL",
] as const;

export type LearningContext = (typeof LEARNING_CONTEXTS)[number];

export interface ContextSubject {
	title?: string | null;
	text?: string | null;
	tags?: readonly string[] | null;
}

const FUNDRAISING = /\b(fundrais\w*|venture capital|\bvc\b|investor\w*|valuation|term sheet|cap table|seed round|series [a-c]|pre-?seed|dilution|safe note|runway)\b/i;
const FOUNDER = /\b(founder|startup|go-?to-?market|gtm|product-?market fit|pmf|business model|pricing strategy|unit economics|traction|pitch|co-?founder)\b/i;
const INTERVIEW = /\b(interview|behaviou?ral|star method|tell me about a time|system design|whiteboard|take-?home|senior \w+ engineer|product engineer|design engineer)\b/i;
const TECHNICAL =
	/\b(react|typescript|javascript|css|html|node|api|graphql|rest|hooks?|state|props|component\w*|design systems?|tokens?|architecture|performance|accessibility|a11y|testing|database|sql|mcp|llm|orchestration)\b/i;

/** Infer the contexts a bank or question plausibly belongs to. Never empty. */
export function inferContexts(subject: ContextSubject): LearningContext[] {
	const haystack = [subject.title, subject.text, ...(subject.tags ?? [])]
		.filter(Boolean)
		.join(" ");
	const found = new Set<LearningContext>();
	if (FUNDRAISING.test(haystack)) found.add("FUNDRAISING");
	if (FOUNDER.test(haystack)) found.add("FOUNDER");
	if (INTERVIEW.test(haystack)) found.add("INTERVIEW");
	if (TECHNICAL.test(haystack)) {
		found.add("TECHNICAL_LEARNING");
		// Technical material is normally interview-relevant unless it is clearly founder-only.
		if (!found.has("FUNDRAISING") && !found.has("FOUNDER")) found.add("INTERVIEW");
	}
	// No signal either way: unclassified material stays usable for study, but is never
	// assumed to be founder/fundraising content.
	if (found.size === 0) {
		found.add("GENERAL");
		found.add("INTERVIEW");
		found.add("TECHNICAL_LEARNING");
	}
	return LEARNING_CONTEXTS.filter((c) => found.has(c));
}

/** Explicit override wins; otherwise infer. */
export function resolveContexts(
	subject: ContextSubject,
	override?: readonly LearningContext[] | null,
): LearningContext[] {
	return override && override.length > 0 ? [...override] : inferContexts(subject);
}

export function matchesContext(
	contexts: readonly LearningContext[],
	active: LearningContext,
): boolean {
	return contexts.includes(active);
}

/**
 * Recruiter-logistics questions: real, but not knowledge retrieval. Excluded from ordinary
 * practice by default (never deleted).
 */
const ADMINISTRATIVE: RegExp[] = [
	/\bsalary\b/i,
	/\bcompensation\b/i,
	/\b(pay|rate) (expectations?|range)\b/i,
	/\bwhen can you start\b/i,
	/\b(notice period|start date|availability to start)\b/i,
	/\bwhy do you want (this|the|to work (at|for)) (job|role|position|company)\b/i,
	/\bwhere do you see yourself\b/i,
	/\bright to work\b|\bvisa\b|\bwork authori[sz]ation\b/i,
	/\bdo you have any questions for (us|me)\b/i,
	/\bwhy are you leaving\b/i,
];

export function isAdministrativeQuestion(text: string): boolean {
	return ADMINISTRATIVE.some((re) => re.test(text));
}

export interface FilterableQuestion {
	id: string;
	text: string;
	tags?: readonly string[] | null;
	/** Optional per-question override, e.g. from a reviewed audit. */
	contextsOverride?: readonly LearningContext[] | null;
	/** Set when the user explicitly kept an administrative question in practice. */
	includeAdministrative?: boolean;
}

export interface QuestionFilterOptions {
	activeContext: LearningContext;
	bankTitle?: string | null;
	includeAdministrative?: boolean;
}

/**
 * Questions eligible for ordinary practice in the active context. Order is preserved and
 * nothing is mutated; filtered-out questions remain stored and keep their history.
 */
export function filterQuestionsForPractice<Q extends FilterableQuestion>(
	questions: readonly Q[],
	options: QuestionFilterOptions,
): Q[] {
	return questions.filter((q) => {
		if (
			!options.includeAdministrative &&
			!q.includeAdministrative &&
			isAdministrativeQuestion(q.text)
		) {
			return false;
		}
		const contexts = resolveContexts(
			{ title: options.bankTitle, text: q.text, tags: q.tags },
			q.contextsOverride,
		);
		return matchesContext(contexts, options.activeContext);
	});
}
