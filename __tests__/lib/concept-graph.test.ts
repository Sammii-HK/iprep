import { describe, expect, it } from "vitest";
import { ConceptGraph, conceptState, prerequisiteGaps, type ConceptEvidence } from "@/lib/concept-graph";

const now = new Date("2026-10-09T12:00:00Z");
const day = (d: number) => new Date(now.getTime() - d * 86_400_000);
const ev = (p: Partial<ConceptEvidence>): ConceptEvidence => ({
	conceptId: "memo",
	kind: "EXPLANATION",
	at: day(0),
	source: "AI_EVALUATION",
	evaluationStatus: "COMPLETED",
	score: 8,
	...p,
});

const graph = () =>
	new ConceptGraph()
		.addConcept({ id: "memo", label: "React memoisation" })
		.addConcept({ id: "eq", label: "Referential equality" })
		.addConcept({ id: "render", label: "Rendering" })
		.addConcept({ id: "closure", label: "Closures" })
		.addEdge({ from: "eq", to: "memo", kind: "PREREQUISITE" })
		.addEdge({ from: "render", to: "memo", kind: "PREREQUISITE" })
		.addEdge({ from: "closure", to: "eq", kind: "PREREQUISITE" });

describe("concept graph", () => {
	it("finds transitive prerequisites and rejects cycles and unknown concepts", () => {
		const g = graph();
		expect(g.prerequisitesOf("memo").sort()).toEqual(["closure", "eq", "render"]);
		expect(() => g.addEdge({ from: "memo", to: "closure", kind: "PREREQUISITE" })).toThrow(/cycle/);
		expect(() => g.addEdge({ from: "nope", to: "memo", kind: "RELATED" })).toThrow(/Unknown/);
	});

	it("maps questions to concepts both ways", () => {
		const g = graph().tagQuestion("q1", ["memo", "eq"]).tagQuestion("q2", ["memo"]);
		expect(g.questionsFor("memo").sort()).toEqual(["q1", "q2"]);
		expect(g.conceptsOf("q1").sort()).toEqual(["eq", "memo"]);
	});
});

describe("concept state is evidence-derived", () => {
	it("listening, viewing, self-grade and failed evaluations never demonstrate", () => {
		const weak: ConceptEvidence[] = [
			ev({ source: "LISTENING", kind: "EXPOSURE", score: undefined, evaluationStatus: undefined }),
			ev({ source: "VIEWED", kind: "EXPOSURE", score: undefined, evaluationStatus: undefined }),
			ev({ source: "SELF_GRADE", score: 10 }),
			ev({ source: "XP", score: 10 }),
			ev({ evaluationStatus: "FAILED", score: 10 }),
		];
		expect(conceptState(weak, now)).toBe("EXPOSED");
		expect(conceptState([], now)).toBe("NOT_ENCOUNTERED");
	});

	it("one good answer is practising, not mastery", () => {
		expect(conceptState([ev({})], now)).toBe("PRACTISING");
	});

	it("demonstrated needs repeated success over time in more than one way", () => {
		const same = [ev({ at: day(10) }), ev({ at: day(5) }), ev({ at: day(0) })];
		expect(conceptState(same, now)).toBe("DEVELOPING"); // one kind only
		const varied = [ev({ at: day(10), kind: "RECALL" }), ev({ at: day(5), kind: "EXPLANATION" }), ev({ at: day(0), kind: "APPLICATION" })];
		expect(conceptState(varied, now)).toBe("DEMONSTRATED");
		const crammed = [ev({ at: day(0.03), kind: "RECALL" }), ev({ at: day(0.02), kind: "EXPLANATION" }), ev({ at: day(0.01), kind: "APPLICATION" })];
		expect(conceptState(crammed, now)).not.toBe("DEMONSTRATED");
	});

	it("old demonstrations return to review", () => {
		const old = [ev({ at: day(80), kind: "RECALL" }), ev({ at: day(70), kind: "EXPLANATION" }), ev({ at: day(60), kind: "APPLICATION" })];
		expect(conceptState(old, now)).toBe("NEEDS_REVIEW");
	});

	it("repeated low scores need review", () => {
		expect(conceptState([ev({ at: day(3), score: 4 }), ev({ at: day(0), score: 3 })], now)).toBe("NEEDS_REVIEW");
	});

	it("suggests only unmastered prerequisites when a learner struggles", () => {
		const g = graph();
		const state = (id: string) => (id === "render" ? ("DEMONSTRATED" as const) : ("PRACTISING" as const));
		expect(prerequisiteGaps(g, "memo", state).sort()).toEqual(["closure", "eq"]);
	});
});
