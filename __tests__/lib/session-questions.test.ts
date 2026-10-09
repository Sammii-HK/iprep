import { describe, expect, it } from "vitest";
import { orderSessionQuestions, type SessionQuestion } from "@/lib/session-questions";
import type { ProgressRecord } from "@/lib/question-selection";

const created = new Date("2026-10-09T09:00:00Z");
const q = (id: string, text: string): SessionQuestion => ({ id, text, bankId: "b", tags: [] });
const qs = [
	q("a", "Explain closures in JavaScript"),
	q("b", "What are your salary expectations?"),
	q("c", "Explain React rendering behaviour"),
	q("d", "Describe CSS specificity rules"),
];
const seen = (daysAgoPracticed: number, dueInDays: number, score = 8): ProgressRecord => ({
	lastPracticed: new Date(created.getTime() - daysAgoPracticed * 86_400_000),
	nextReviewAt: new Date(created.getTime() + dueInDays * 86_400_000),
	lastScore: score,
	repetitions: 2,
});

describe("orderSessionQuestions", () => {
	it("removes administrative questions and prefers due/new over recent", () => {
		const progress = new Map([
			["a", seen(0.2, 5)], // answered this morning, not due: should not lead
			["c", seen(10, -2)], // due
		]);
		const out = orderSessionQuestions({ questions: qs, answeredInSession: [], progress, sessionCreatedAt: created });
		expect(out.map((x) => x.id)).not.toContain("b");
		expect(out[0].id).toBe("c");
		expect(out.at(-1)?.id).toBe("a");
	});

	it("is stable as answers arrive: answered pinned first, remainder keeps its order", () => {
		const base = { questions: qs, progress: new Map<string, ProgressRecord>(), sessionCreatedAt: created };
		const before = orderSessionQuestions({ ...base, answeredInSession: [] }).map((x) => x.id);
		const after = orderSessionQuestions({
			...base,
			answeredInSession: [before[0]],
			// answering also updates progress for that question
			progress: new Map([[before[0], seen(0, 3)]]),
		}).map((x) => x.id);
		expect(after).toEqual(before);
	});

	it("honours maxQuestions including already-answered ones", () => {
		const out = orderSessionQuestions({ questions: qs, answeredInSession: ["a"], progress: new Map(), sessionCreatedAt: created, maxQuestions: 2 });
		expect(out.map((x) => x.id)[0]).toBe("a");
		expect(out).toHaveLength(2);
	});

	it("never returns an empty session when everything was recently practised", () => {
		const progress = new Map(["a", "c", "d"].map((id) => [id, seen(0.1, 5)] as const));
		const out = orderSessionQuestions({ questions: qs, answeredInSession: [], progress, sessionCreatedAt: created, maxQuestions: 2 });
		expect(out.length).toBe(2);
	});
});
