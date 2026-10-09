/**
 * Role -> skills -> bank recommendations. Titles are matched loosely (no exact title
 * matching) and several target roles can be active at once. Recommendations are advice:
 * they never alter the learner's manual selection.
 */

import { inferContexts, type LearningContext } from "./learning-context";

export interface RoleProfile {
	id: string;
	/** Loose title patterns, e.g. "Senior Product Engineer" matches /product engineer/. */
	titlePatterns: RegExp[];
	skills: string[];
}

export const DEFAULT_ROLE_PROFILES: RoleProfile[] = [
	{
		id: "design-engineer",
		titlePatterns: [/design engineer/i, /ui engineer/i, /design technologist/i],
		skills: ["design system", "design tokens", "accessibility", "css", "component", "react", "interaction", "animation"],
	},
	{
		id: "product-engineer",
		titlePatterns: [/product engineer/i, /full[- ]?stack/i],
		skills: ["product", "react", "typescript", "architecture", "api", "experiment", "trade-off", "collaboration"],
	},
	{
		id: "frontend-engineer",
		titlePatterns: [/front[- ]?end/i, /web (developer|engineer)/i],
		skills: ["react", "javascript", "typescript", "css", "performance", "accessibility", "rendering", "testing"],
	},
	{
		id: "ai-product-engineer",
		titlePatterns: [/\bai\b.*engineer/i, /\bllm\b/i, /machine learning engineer/i],
		skills: ["llm", "agent", "tool calling", "mcp", "evaluation", "orchestration", "reliability", "prompt"],
	},
];

/** All profiles whose title patterns match. A title can match several. */
export function matchRoles(
	title: string,
	profiles: readonly RoleProfile[] = DEFAULT_ROLE_PROFILES,
): RoleProfile[] {
	return profiles.filter((p) => p.titlePatterns.some((re) => re.test(title)));
}

export interface InterviewLike {
	company: string;
	role: string;
	startsAt: Date;
	status?: string;
}

const DAY = 86_400_000;

/**
 * Weight 0..1 for an interview: ramps up over the two weeks before it, then drops to 0 once
 * it has passed or been cancelled so recommendations return to the learner's broader goals.
 */
export function interviewWeight(i: InterviewLike, now: Date): number {
	if (i.status && i.status !== "scheduled") return 0;
	const days = (i.startsAt.getTime() - now.getTime()) / DAY;
	if (days < 0 || days > 14) return 0;
	return Math.min(1, Math.round((1 - days / 14 + 0.1) * 100) / 100);
}

export interface BankSummary {
	id: string;
	title: string;
	/** A sample of question texts, to judge relevance beyond the title. */
	sampleQuestions?: readonly string[];
	contextsOverride?: readonly LearningContext[];
}

export interface Recommendation {
	bankId: string;
	score: number;
	reasons: string[];
}

export interface RecommendInput {
	targetRoleTitles: readonly string[];
	interviews: readonly InterviewLike[];
	banks: readonly BankSummary[];
	activeContext: LearningContext;
	now: Date;
	profiles?: readonly RoleProfile[];
}

const hits = (hay: string, skills: readonly string[]) =>
	skills.filter((s) => hay.includes(s.toLowerCase()));

/**
 * Rank banks for the active context from target roles plus upcoming interviews. A bank
 * relevant to several roles appears once, with all reasons merged.
 */
export function recommendBanks(input: RecommendInput): Recommendation[] {
	const profiles = input.profiles ?? DEFAULT_ROLE_PROFILES;
	const roleSkills = new Map<string, string[]>(); // skill -> role ids
	for (const title of input.targetRoleTitles) {
		for (const p of matchRoles(title, profiles)) {
			for (const s of p.skills) roleSkills.set(s, [...new Set([...(roleSkills.get(s) ?? []), p.id])]);
		}
	}
	const upcoming = input.interviews
		.map((i) => ({ i, w: interviewWeight(i, input.now) }))
		.filter((x) => x.w > 0);

	const out: Recommendation[] = [];
	for (const bank of input.banks) {
		const contexts =
			bank.contextsOverride && bank.contextsOverride.length
				? [...bank.contextsOverride]
				: inferContexts({ title: bank.title, text: (bank.sampleQuestions ?? []).join(" ") });
		if (!contexts.includes(input.activeContext)) continue;

		const hay = `${bank.title} ${(bank.sampleQuestions ?? []).join(" ")}`.toLowerCase();
		const reasons: string[] = [];
		let score = 0;

		const matched = hits(hay, [...roleSkills.keys()]);
		if (matched.length) {
			score += matched.length * 5;
			const roles = [...new Set(matched.flatMap((s) => roleSkills.get(s) ?? []))];
			reasons.push(`Covers ${matched.slice(0, 3).join(", ")} for your ${roles.join(" / ")} target`);
		}
		for (const { i, w } of upcoming) {
			const terms = matchRoles(i.role, profiles).flatMap((p) => p.skills);
			const roleHits = hits(hay, terms);
			const companyHit = hay.includes(i.company.toLowerCase());
			if (roleHits.length || companyHit) {
				score += (roleHits.length * 8 + (companyHit ? 10 : 0)) * (0.5 + w);
				reasons.push(`Relevant to your ${i.role} interview at ${i.company}`);
			}
		}
		if (score > 0) out.push({ bankId: bank.id, score: Math.round(score * 10) / 10, reasons: [...new Set(reasons)] });
	}
	return out.sort((a, b) => b.score - a.score || a.bankId.localeCompare(b.bankId));
}

/** Terms for the question-selection engine. */
export function selectionTerms(input: Pick<RecommendInput, "targetRoleTitles" | "interviews" | "now"> & { profiles?: readonly RoleProfile[] }) {
	const profiles = input.profiles ?? DEFAULT_ROLE_PROFILES;
	const roleTerms = [...new Set(input.targetRoleTitles.flatMap((t) => matchRoles(t, profiles).flatMap((p) => p.skills)))];
	const interviewTerms = [
		...new Set(
			input.interviews
				.filter((i) => interviewWeight(i, input.now) > 0)
				.flatMap((i) => [i.company.toLowerCase(), ...matchRoles(i.role, profiles).flatMap((p) => p.skills)]),
		),
	];
	return { roleTerms, interviewTerms };
}
