import { describe, expect, it } from "vitest";
import {
	filterQuestionsForPractice,
	inferContexts,
	isAdministrativeQuestion,
} from "@/lib/learning-context";

const q = (id: string, text: string, tags: string[] = []) => ({ id, text, tags });

describe("learning contexts", () => {
	const questions = [
		q("react", "How does React reconciliation decide what to re-render?"),
		q("val", "How do you negotiate valuation with a seed investor?"),
		q("salary", "What are your salary expectations?"),
		q("pmf", "How do you know you have product-market fit?"),
	];

	it("interview mode hides fundraising questions", () => {
		const ids = filterQuestionsForPractice(questions, { activeContext: "INTERVIEW" }).map((x) => x.id);
		expect(ids).toContain("react");
		expect(ids).not.toContain("val");
	});

	it("fundraising mode hides React interview questions but shows fundraising", () => {
		const ids = filterQuestionsForPractice(questions, { activeContext: "FUNDRAISING" }).map((x) => x.id);
		expect(ids).toContain("val");
		expect(ids).not.toContain("react");
	});

	it("excludes administrative questions by default but can include them", () => {
		for (const t of [
			"What are your salary expectations?",
			"Why do you want this job?",
			"When can you start?",
			"What compensation are you looking for?",
		]) {
			expect(isAdministrativeQuestion(t)).toBe(true);
		}
		expect(isAdministrativeQuestion("Explain design tokens")).toBe(false);
		const withAdmin = filterQuestionsForPractice(
			[q("s", "What are your salary expectations?")],
			{ activeContext: "GENERAL", includeAdministrative: true },
		);
		expect(withAdmin).toHaveLength(1);
	});

	it("a question can belong to several contexts, and overrides win", () => {
		expect(inferContexts({ text: "Explain startup pricing strategy and React" })).toEqual(
			expect.arrayContaining(["FOUNDER", "TECHNICAL_LEARNING"]),
		);
		const out = filterQuestionsForPractice(
			[{ ...q("o", "Explain valuation"), contextsOverride: ["INTERVIEW" as const] }],
			{ activeContext: "INTERVIEW" },
		);
		expect(out).toHaveLength(1);
	});

	it("does not mutate or reorder input", () => {
		const copy = [...questions];
		filterQuestionsForPractice(questions, { activeContext: "INTERVIEW" });
		expect(questions).toEqual(copy);
	});
});
