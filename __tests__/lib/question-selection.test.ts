import { describe, expect, it } from "vitest";
import { selectQuestions, type Candidate, type ProgressRecord } from "@/lib/question-selection";

const now = new Date("2026-10-09T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const q = (id: string, text: string, bankId = "b1", extra: Partial<Candidate> = {}): Candidate => ({
	id,
	text,
	bankId,
	tags: [],
	...extra,
});
const prog = (p: Partial<ProgressRecord>): ProgressRecord => ({
	nextReviewAt: daysAgo(-5),
	lastPracticed: daysAgo(3),
	lastScore: 8,
	repetitions: 2,
	...p,
});
const base = { now, count: 5, activeContext: "INTERVIEW" as const };
const ids = (r: { question: { id: string } }[]) => r.map((x) => x.question.id);

describe("question selection", () => {
	it("prioritises due and new over merely practised, and says why", () => {
		const cs = [q("new", "Explain closures in JavaScript"), q("due", "Explain React rendering"), q("ok", "Explain CSS specificity rules")];
		const p = new Map([
			["due", prog({ nextReviewAt: daysAgo(2) })],
			["ok", prog({})],
		]);
		const r = selectQuestions(cs, p, base);
		expect(ids(r).slice(0, 2).sort()).toEqual(["due", "new"]);
		expect(r.find((x) => x.question.id === "new")?.reasons).toContain("New question");
		expect(r.find((x) => x.question.id === "due")?.reasons).toContain("Due for review");
	});

	it("does not repeat recently answered questions unless due, weak, or asked", () => {
		const cs = [q("a", "Explain event delegation"), q("b", "Explain hoisting behaviour")];
		const p = new Map([["a", prog({ lastPracticed: daysAgo(0.1) })]]);
		expect(ids(selectQuestions(cs, p, base))).toEqual(["b"]);
		expect(ids(selectQuestions(cs, p, { ...base, recentQuestionIds: ["b"] }))).toEqual([]);
		expect(ids(selectQuestions(cs, p, { ...base, allowRepeats: true }))).toContain("a");
		const weak = new Map([["a", prog({ lastPracticed: daysAgo(0.1), lastScore: 3 })]]);
		expect(ids(selectQuestions(cs, weak, base))).toContain("a");
	});

	it("excludes administrative and out-of-context questions", () => {
		const cs = [
			q("react", "Explain React reconciliation"),
			q("salary", "What are your salary expectations?"),
			q("val", "How do you negotiate valuation with investors?"),
		];
		expect(ids(selectQuestions(cs, new Map(), base))).toEqual(["react"]);
		expect(ids(selectQuestions(cs, new Map(), { ...base, activeContext: "FUNDRAISING" }))).toEqual(["val"]);
	});

	it("respects explicit bank selection and never defaults to everything", () => {
		const cs = [q("a", "Explain React hooks rules", "b1"), q("b", "Explain TypeScript generics", "b2")];
		expect(ids(selectQuestions(cs, new Map(), { ...base, selectedBankIds: ["b2"] }))).toEqual(["b"]);
	});

	it("dedupes near-duplicates and shared concepts across banks", () => {
		const cs = [
			q("a", "Explain how React reconciliation works", "b1"),
			q("b", "Explain how React reconciliation works?", "b2"),
			q("c", "What is referential equality", "b1", { conceptKey: "eq" }),
			q("d", "Why does identity matter for memoisation", "b2", { conceptKey: "eq" }),
		];
		const r = ids(selectQuestions(cs, new Map(), base));
		expect(r.filter((i) => i === "a" || i === "b")).toHaveLength(1);
		expect(r.filter((i) => i === "c" || i === "d")).toHaveLength(1);
	});

	it("boosts interview-relevant questions without hiding others", () => {
		const cs = [q("gen", "Explain CSS grid layout"), q("rel", "Explain design tokens in a design system")];
		const r = selectQuestions(cs, new Map(), { ...base, interviewTerms: ["design system"] });
		expect(ids(r)[0]).toBe("rel");
		expect(ids(r)).toContain("gen");
		expect(r[0].reasons).toContain("Relevant to your upcoming interview");
	});

	it("is deterministic and interleaves banks", () => {
		const cs = [
			q("a1", "Explain promises in detail", "A"),
			q("a2", "Describe garbage collection mechanics", "A"),
			q("b1", "Outline http caching strategies", "B"),
		];
		const r1 = ids(selectQuestions(cs, new Map(), { ...base, count: 2 }));
		expect(r1).toEqual(ids(selectQuestions(cs, new Map(), { ...base, count: 2 })));
		expect(r1).toContain("b1");
	});
});
