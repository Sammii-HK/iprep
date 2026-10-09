/**
 * Engagement rules that sit on top of the same evidence model: XP rewards meaningful
 * learning (never repetition, listening or keyword stuffing), challenge modes yield real
 * evidence requests, and celebrations are occasional and respect Reduce Motion.
 * XP is motivation, not evidence of understanding, and never feeds concept state.
 */

import type { LearningContext } from "./learning-context";

export interface XpEvent {
	kind: "ANSWER" | "CHALLENGE" | "BOSS" | "TEACH_BACK" | "LISTEN";
	/** Completed evaluation score 0..10; absent when the evaluation failed. */
	score?: number | null;
	difficulty?: number;
	/** Days since this question was last answered successfully; large = long-term retention. */
	daysSinceLastCorrect?: number | null;
	/** True if the concept was previously weak and this answer improved it. */
	improvedWeakConcept?: boolean;
	/** True if this exact question was already answered today (meaningless repetition). */
	repeatToday?: boolean;
}

export function xpFor(e: XpEvent): number {
	if (e.kind === "LISTEN") return 1; // token acknowledgement; listening is exposure
	if (e.repeatToday) return 0;
	if (e.score === undefined || e.score === null || !Number.isFinite(e.score)) return 0; // failed evaluation earns nothing
	let xp = 2;
	if (e.score >= 7) xp += 3;
	xp += Math.max(0, Math.min(5, (e.difficulty ?? 1) - 1));
	if ((e.daysSinceLastCorrect ?? 0) >= 7 && e.score >= 7) xp += 5; // long-term retention
	if (e.improvedWeakConcept) xp += 4;
	if (e.kind === "BOSS") xp += 10;
	if (e.kind === "CHALLENGE" || e.kind === "TEACH_BACK") xp += 3;
	return xp;
}

export const LEVEL_THRESHOLDS = [0, 50, 150, 300, 500, 800, 1200];
export function levelFor(totalXp: number): { level: number; toNext: number | null } {
	let level = 1;
	for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) if (totalXp >= LEVEL_THRESHOLDS[i]) level = i + 1;
	const next = LEVEL_THRESHOLDS[level];
	return { level, toNext: next === undefined ? null : next - totalXp };
}

export type ChaosKind =
	| "EXPLAIN_BACKWARDS"
	| "SPOT_THE_MISTAKE"
	| "DEFEND_OPPOSITE"
	| "CONNECT_TWO"
	| "NO_JARGON"
	| "THIRTY_SECONDS"
	| "CHANGE_CONSTRAINTS"
	| "MISSING_ASSUMPTION";

export interface Challenge {
	kind: ChaosKind;
	prompt: string;
	/** The evidence this challenge produces, so it never yields arbitrary scores. */
	evidenceKind: "EXPLANATION" | "DISCRIMINATION" | "APPLICATION";
	timeLimitSeconds: number | null;
	/** The rubric tweak for this challenge. NO_JARGON explicitly lifts the terminology rule. */
	rubricNote: string;
}

export function buildChallenge(kind: ChaosKind, concept: string, other?: string): Challenge {
	switch (kind) {
		case "EXPLAIN_BACKWARDS":
			return { kind, prompt: `Explain ${concept} starting from the result, then work back to the cause.`, evidenceKind: "EXPLANATION", timeLimitSeconds: null, rubricNote: "Judge correctness of the causal chain, not the order of words." };
		case "SPOT_THE_MISTAKE":
			return { kind, prompt: `Here is a flawed explanation of ${concept}. What is wrong with it?`, evidenceKind: "DISCRIMINATION", timeLimitSeconds: null, rubricNote: "Credit identifying the real error; penalise inventing errors that are not there." };
		case "DEFEND_OPPOSITE":
			return { kind, prompt: `Argue for the opposite approach to ${concept}. When would it be right?`, evidenceKind: "APPLICATION", timeLimitSeconds: null, rubricNote: "Judge the quality of reasoning and trade-offs, not agreement." };
		case "CONNECT_TWO":
			return { kind, prompt: `How does ${concept} relate to ${other ?? "another concept you know"}?`, evidenceKind: "EXPLANATION", timeLimitSeconds: null, rubricNote: "Only real relationships count; keyword linking earns nothing." };
		case "NO_JARGON":
			return { kind, prompt: `Explain ${concept} to a beginner without technical jargon.`, evidenceKind: "EXPLANATION", timeLimitSeconds: null, rubricNote: "Here, avoiding specialist terms is the goal; judge accuracy of the plain-language explanation." };
		case "THIRTY_SECONDS":
			return { kind, prompt: `Explain ${concept} in 30 seconds.`, evidenceKind: "EXPLANATION", timeLimitSeconds: 30, rubricNote: "Reward prioritising the essential idea. Do not penalise omitted depth." };
		case "CHANGE_CONSTRAINTS":
			return { kind, prompt: `Your constraints just changed for ${concept}. What do you do differently?`, evidenceKind: "APPLICATION", timeLimitSeconds: null, rubricNote: "Judge adaptation of the reasoning." };
		case "MISSING_ASSUMPTION":
			return { kind, prompt: `What assumption is hidden in the usual explanation of ${concept}?`, evidenceKind: "DISCRIMINATION", timeLimitSeconds: null, rubricNote: "Credit genuine assumptions; do not reward generic caveats." };
	}
}

export interface BossStage {
	name: string;
	evidenceKind: "RECALL" | "EXPLANATION" | "APPLICATION";
}
export interface Boss {
	id: string;
	title: string;
	context: LearningContext;
	stages: BossStage[];
}

/** Bosses live inside a learning context so an interview boss never asks about fundraising. */
export const BOSSES: Boss[] = [
	{ id: "react-performance", title: "React performance", context: "INTERVIEW", stages: [{ name: "Diagnose", evidenceKind: "APPLICATION" }, { name: "Explain", evidenceKind: "EXPLANATION" }, { name: "Optimise", evidenceKind: "APPLICATION" }, { name: "Defend", evidenceKind: "EXPLANATION" }] },
	{ id: "system-design", title: "System design", context: "INTERVIEW", stages: [{ name: "Requirements", evidenceKind: "RECALL" }, { name: "Architecture", evidenceKind: "APPLICATION" }, { name: "Trade-offs", evidenceKind: "EXPLANATION" }, { name: "Scaling", evidenceKind: "APPLICATION" }] },
	{ id: "founder-pitch", title: "Founder pitch", context: "FOUNDER", stages: [{ name: "Pitch", evidenceKind: "EXPLANATION" }, { name: "Objections", evidenceKind: "APPLICATION" }, { name: "Business model", evidenceKind: "EXPLANATION" }, { name: "Differentiation", evidenceKind: "EXPLANATION" }] },
];

export const bossesFor = (context: LearningContext) => BOSSES.filter((b) => b.context === context);

/** Teach-back: the persona asks about gaps the learner left, never invents new facts. */
export function teachBackQuestions(demonstrated: readonly string[], missingCore: readonly string[], persona: "Jess" | "Zac"): string[] {
	const qs = missingCore.slice(0, 2).map((m) => `${persona}: I follow so far, but what about ${m}? How does that fit in?`);
	if (demonstrated[0]) qs.push(`${persona}: Can you give me an example of ${demonstrated[0]} in real code?`);
	return qs;
}

export type Season = "HALLOWEEN" | "WINTER" | "SPRING" | "SUMMER" | null;
export function seasonFor(d: Date): Season {
	const m = d.getUTCMonth() + 1;
	const day = d.getUTCDate();
	if ((m === 10 && day >= 20) || (m === 11 && day <= 2)) return "HALLOWEEN";
	if (m === 12 || m <= 2) return "WINTER";
	if (m >= 3 && m <= 5) return "SPRING";
	if (m >= 6 && m <= 8) return "SUMMER";
	return null;
}

export interface Celebration {
	season: Season;
	motion: "FULL" | "STATIC";
	particles: string[];
}
const PARTICLES: Record<Exclude<Season, null>, string[]> = {
	HALLOWEEN: ["ghost", "pumpkin", "bat", "confetti"],
	WINTER: ["snowflake", "star"],
	SPRING: ["flower", "petal"],
	SUMMER: ["star", "sun"],
};

/** Only meaningful achievements celebrate; Reduce Motion yields a static celebration. */
export function celebrationFor(achievement: { meaningful: boolean }, now: Date, reduceMotion: boolean): Celebration | null {
	if (!achievement.meaningful) return null;
	const season = seasonFor(now);
	return { season, motion: reduceMotion ? "STATIC" : "FULL", particles: season ? PARTICLES[season] : ["confetti"] };
}
