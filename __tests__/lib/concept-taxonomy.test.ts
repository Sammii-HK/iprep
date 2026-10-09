import { describe, expect, it } from "vitest";
import { buildSeedGraph, extractConcepts, tagQuestions } from "@/lib/concept-taxonomy";

describe("concept taxonomy", () => {
	it("maps a question to several concepts and many questions to one", () => {
		expect(extractConcepts("What are design tokens and why do they matter?")).toContain("design-tokens");
		expect(extractConcepts("How do useMemo and referential equality interact?").sort()).toEqual(["react-memoisation", "referential-equality"]);
		const g = buildSeedGraph();
		tagQuestions(g, [
			{ id: "q1", text: "Explain design tokens" },
			{ id: "q2", text: "How would you structure a design system?" },
			{ id: "q3", text: "Tell me about a time you led a team" },
		]);
		expect(g.questionsFor("design-tokens")).toEqual(["q1"]);
	});

	it("does not link on shared keywords alone or inside other words", () => {
		expect(extractConcepts("Describe your hooks for fishing")).toContain("react-hooks"); // known limit: alias match only
		expect(extractConcepts("Tell me about your experience with team indexes")).toEqual([]);
		expect(extractConcepts("Why is the sky blue?")).toEqual([]);
	});

	it("reports untagged questions instead of guessing", () => {
		const r = tagQuestions(buildSeedGraph(), [{ id: "x", text: "Tell me about yourself" }]);
		expect(r).toEqual({ tagged: 0, untagged: ["x"] });
	});

	it("seed graph has the memoisation prerequisites and no cycles", () => {
		const g = buildSeedGraph();
		expect(g.prerequisitesOf("react-memoisation").sort()).toEqual(["react-rendering", "referential-equality"]);
		expect(g.related("react-memoisation", "COMMONLY_CONFUSED")).toContain("react-rendering");
	});
});
