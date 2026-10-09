/**
 * Evidence-based interview readiness and the Today plan. Readiness is guidance for choosing
 * practice, not a hiring prediction: sparse evidence yields "insufficient evidence", never a
 * precise-looking percentage.
 */

import type { ConceptState } from "./concept-graph";

export type ReadinessDimension =
	| "coverage"
	| "recall"
	| "explanation"
	| "application"
	| "stories"
	| "communication"
	| "recency";

export interface ReadinessInput {
	/** Concepts relevant to the interview and their derived states. */
	concepts: readonly ConceptState[];
	/** Completed (not failed) evaluated attempts relevant to the interview, most recent first. */
	evaluatedAttempts: readonly { at: Date; kind: "RECALL" | "EXPLANATION" | "APPLICATION" | "STORY"; score: number; delivery?: number }[];
	storyCount: number;
	now: Date;
}

export interface DimensionReading {
	dimension: ReadinessDimension;
	level: "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH";
	/** Plain-language evidence behind the level. */
	evidence: string;
}

export interface Readiness {
	confidence: "INSUFFICIENT_EVIDENCE" | "LOW" | "MODERATE" | "GOOD";
	dimensions: DimensionReading[];
	/** Dimensions to practise next, weakest/unknown first. */
	focus: ReadinessDimension[];
	disclaimer: string;
}

const MIN_ATTEMPTS = 8;
const DAY = 86_400_000;

const level = (n: number, v: number): DimensionReading["level"] =>
	n < 2 ? "UNKNOWN" : v >= 7 ? "HIGH" : v >= 5 ? "MEDIUM" : "LOW";
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function assessReadiness(i: ReadinessInput): Readiness {
	const by = (k: ReadinessInput["evaluatedAttempts"][number]["kind"]) => i.evaluatedAttempts.filter((a) => a.kind === k);
	const reading = (dimension: ReadinessDimension, kind: Parameters<typeof by>[0]): DimensionReading => {
		const xs = by(kind).map((a) => a.score);
		const l = level(xs.length, avg(xs));
		return { dimension, level: l, evidence: l === "UNKNOWN" ? `Fewer than 2 evaluated ${kind.toLowerCase()} answers` : `${xs.length} evaluated answers, average ${avg(xs).toFixed(1)}/10` };
	};

	const total = i.concepts.length;
	const demonstrated = i.concepts.filter((c) => c === "DEMONSTRATED" || c === "DEVELOPING").length;
	const coverageRatio = total ? demonstrated / total : 0;
	const delivery = i.evaluatedAttempts.map((a) => a.delivery).filter((d): d is number => typeof d === "number");
	const recent = i.evaluatedAttempts.filter((a) => (i.now.getTime() - a.at.getTime()) / DAY <= 7).length;

	const dimensions: DimensionReading[] = [
		{
			dimension: "coverage",
			level: total < 3 ? "UNKNOWN" : coverageRatio >= 0.7 ? "HIGH" : coverageRatio >= 0.4 ? "MEDIUM" : "LOW",
			evidence: total < 3 ? "Too few mapped concepts" : `${demonstrated} of ${total} relevant concepts developing or demonstrated`,
		},
		reading("recall", "RECALL"),
		reading("explanation", "EXPLANATION"),
		reading("application", "APPLICATION"),
		{
			dimension: "stories",
			level: i.storyCount >= 4 ? "HIGH" : i.storyCount >= 2 ? "MEDIUM" : i.storyCount >= 1 ? "LOW" : "UNKNOWN",
			evidence: `${i.storyCount} personal stor${i.storyCount === 1 ? "y" : "ies"} recorded`,
		},
		{
			dimension: "communication",
			level: level(delivery.length, avg(delivery)),
			evidence: delivery.length < 2 ? "Not enough delivery evaluations" : `Delivery average ${avg(delivery).toFixed(1)}/10`,
		},
		{ dimension: "recency", level: recent >= 5 ? "HIGH" : recent >= 2 ? "MEDIUM" : recent >= 1 ? "LOW" : "UNKNOWN", evidence: `${recent} evaluated answers in the last 7 days` },
	];

	const known = dimensions.filter((d) => d.level !== "UNKNOWN").length;
	const confidence: Readiness["confidence"] =
		i.evaluatedAttempts.length < MIN_ATTEMPTS || known < 3
			? "INSUFFICIENT_EVIDENCE"
			: known < 5
				? "LOW"
				: dimensions.every((d) => d.level === "UNKNOWN" || d.level !== "LOW") && known >= 6
					? "GOOD"
					: "MODERATE";

	const order = { UNKNOWN: 0, LOW: 1, MEDIUM: 2, HIGH: 3 } as const;
	const focus = [...dimensions].sort((a, b) => order[a.level] - order[b.level]).filter((d) => d.level !== "HIGH").slice(0, 3).map((d) => d.dimension);

	return {
		confidence,
		dimensions,
		focus,
		disclaimer: "This guides what to practise next. It does not predict whether an employer will hire you.",
	};
}

export interface TodayInput {
	minutesAvailable: number;
	dueCount: number;
	unseenCount: number;
	weakConceptCount: number;
	storyCount: number;
	upcomingInterview: { company: string; role: string; daysAway: number } | null;
	/** Questions answered today; used to avoid pushing a full plan on a light day. */
	answeredToday: number;
	restDay?: boolean;
}

export interface TodayPlan {
	headline: string;
	total: number;
	mix: { due: number; unseen: number; weak: number; application: number };
	notes: string[];
}

const MIN_PER_QUESTION = 2;

/**
 * Today plan: proportions adapt to what actually exists (no due reviews → no due share),
 * the interview raises weak-area focus, and short time yields a short session. Nothing
 * punishes a missed day.
 */
export function planToday(i: TodayInput): TodayPlan {
	if (i.restDay) {
		return { headline: "Rest day. Come back whenever you like.", total: 0, mix: { due: 0, unseen: 0, weak: 0, application: 0 }, notes: ["Rest days never break your weekly consistency."] };
	}
	const total = Math.max(1, Math.floor(i.minutesAvailable / MIN_PER_QUESTION));
	let shares = { due: 0.4, unseen: 0.25, weak: 0.2, application: 0.15 };
	if (i.upcomingInterview && i.upcomingInterview.daysAway <= 3) shares = { due: 0.3, unseen: 0.1, weak: 0.35, application: 0.25 };
	if (i.dueCount === 0) shares = { ...shares, unseen: shares.unseen + shares.due / 2, weak: shares.weak + shares.due / 2, due: 0 };
	if (i.unseenCount === 0) shares = { ...shares, due: shares.due + shares.unseen, unseen: 0 };
	if (i.weakConceptCount === 0) shares = { ...shares, due: shares.due + shares.weak, weak: 0 };

	const cap = { due: i.dueCount, unseen: i.unseenCount, weak: i.weakConceptCount * 2, application: Math.max(total, i.storyCount + total) };
	const mix = {
		due: Math.min(Math.round(total * shares.due), cap.due),
		unseen: Math.min(Math.round(total * shares.unseen), cap.unseen),
		weak: Math.min(Math.round(total * shares.weak), cap.weak),
		application: Math.round(total * shares.application),
	};
	// Rounding can under-fill short sessions: top up from the buckets with the largest share.
	const order = (Object.keys(shares) as (keyof typeof shares)[]).sort((a, b) => shares[b] - shares[a]);
	const sum = () => mix.due + mix.unseen + mix.weak + mix.application;
	for (let guard = 0; sum() < total && guard < 50; guard++) {
		const k = order.find((key) => shares[key] > 0 && mix[key] < cap[key]);
		if (!k) break;
		mix[k] += 1;
	}
	const used = sum();
	const notes: string[] = [];
	if (i.answeredToday > 0) notes.push(`You've already answered ${i.answeredToday} today. Any more is a bonus.`);
	return {
		headline: i.upcomingInterview
			? `${i.upcomingInterview.daysAway <= 0 ? "Today" : `In ${i.upcomingInterview.daysAway} day(s)`}: ${i.upcomingInterview.role} at ${i.upcomingInterview.company}`
			: "Pick up where you left off",
		total: used,
		mix,
		notes,
	};
}
