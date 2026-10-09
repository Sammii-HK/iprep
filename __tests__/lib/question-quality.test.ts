import { describe, expect, it } from "vitest";
import { auditQuestions, classifyQuestion } from "@/lib/question-quality";

const item = (id: string, text: string, hint = "A reasonably complete reference answer here.") => ({
	id,
	bank: "Test bank",
	text,
	hint,
});

describe("question quality audit", () => {
	it("classifies administrative questions and excludes them from practice, never deleting", () => {
		for (const t of ["What are your salary expectations?", "When can you start?", "Why do you want this job?"]) {
			const r = classifyQuestion(item("x", t));
			expect(r.classification).toBe("ADMINISTRATIVE");
			expect(r.action).toBe("EXCLUDE_FROM_PRACTICE");
		}
	});

	it("keeps founder and fundraising material, reclassified, never deleted", () => {
		const f = classifyQuestion(item("f", "How do you negotiate valuation with seed investors?"));
		expect(f.classification).toBe("FUNDRAISING");
		expect(f.action).toBe("RECLASSIFY");
		expect(f.contexts).not.toContain("INTERVIEW");
	});

	it("recognises good learning and behavioural questions", () => {
		expect(classifyQuestion(item("a", "How would you design a component library for multiple product teams?")).action).toBe("KEEP");
		expect(classifyQuestion(item("b", "Tell me about a time you disagreed with a product designer.")).classification).toBe("BEHAVIOURAL");
	});

	it("flags vague, outdated and answerless questions for improvement", () => {
		expect(classifyQuestion(item("v", "Explain")).classification).toBe("NEEDS_REVIEW");
		expect(classifyQuestion(item("o", "How do you fix layout bugs in Internet Explorer 8?")).classification).toBe("OUTDATED");
		expect(classifyQuestion(item("n", "Explain the virtual DOM in React", "")).action).toBe("IMPROVE");
	});

	it("groups near-duplicates for review and archives only the later one", () => {
		const rows = auditQuestions([
			item("1", "Explain how React reconciliation works"),
			item("2", "Explain how React reconciliation works?"),
			item("3", "What is referential equality?"),
		]);
		expect(rows[0].action).toBe("KEEP");
		expect(rows[1].classification).toBe("DUPLICATE_CANDIDATE");
		expect(rows[1].duplicateOf).toEqual(["1"]);
		expect(rows[2].duplicateOf).toEqual([]);
	});
});
