import { describe, expect, it } from "vitest";
import { buildFeedback, finaliseEvaluation, groundAnalysis, isGrounded, type AnswerAnalysis } from "@/lib/answer-analysis";
import { rubricPromptSection, selectRubric } from "@/lib/rubrics";

const transcript =
	"Design tokens are named values. Primitive tokens hold raw values and semantic tokens give them meaning. " +
	"I also think tokens are stored in the database at runtime for every component.";

const base: AnswerAnalysis = {
	rubricVersion: "rubric-technical@1",
	demonstrated: [{ concept: "semantic tokens", evidence: "semantic tokens give them meaning" }],
	mentionedOnly: [],
	missing: [
		{ concept: "token propagation", criterionId: "coverage", core: true },
		{ concept: "governance", criterionId: "tradeoffs", core: false },
	],
	misconceptions: [
		{ concept: "runtime database storage", evidence: "stored in the database at runtime", correction: "Tokens are normally compiled at build time." },
	],
	deepen: ["Contribution workflow"],
	strength: { concept: "primitive vs semantic tokens", evidence: "Primitive tokens hold raw values" },
	nextStep: null,
	followUp: { question: "How would you handle a breaking token change used by six teams?", targetsConcept: "token propagation" },
};

describe("rubric selection", () => {
	it("uses the right rubric per question type", () => {
		expect(selectRubric({ text: "Tell me about a time you disagreed with a designer" })?.kind).toBe("BEHAVIOURAL");
		expect(selectRubric({ text: "How would you design a scalable design system?" })?.kind).toBe("SYSTEM_DESIGN");
		expect(selectRubric({ text: "Explain design tokens" })?.kind).toBe("TECHNICAL_EXPLANATION");
		expect(selectRubric({ text: "How do you negotiate valuation with investors?" })?.kind).toBe("FOUNDER");
		expect(selectRubric({ text: "What are your salary expectations?" })).toBeNull();
	});
	it("does not apply STAR to technical answers or require invented metrics", () => {
		const tech = selectRubric({ text: "Explain React reconciliation" })!;
		expect(tech.criteria.map((c) => c.id)).not.toContain("outcome");
		const beh = selectRubric({ text: "Tell me about a time you led a project" })!;
		expect(rubricPromptSection(beh)).toMatch(/must never be invented/);
		expect(rubricPromptSection(tech)).toMatch(/never a flaw/);
	});
});

describe("answer analysis", () => {
	it("drops claims whose evidence is not in the transcript", () => {
		const bad: AnswerAnalysis = {
			...base,
			demonstrated: [...base.demonstrated, { concept: "theming", evidence: "we used CSS variables for theming" }],
		};
		const g = groundAnalysis(bad, transcript);
		expect(g.analysis.demonstrated.map((d) => d.concept)).toEqual(["semantic tokens"]);
		expect(g.ungrounded).toEqual(["theming"]);
		expect(isGrounded("SEMANTIC tokens  give them meaning!", transcript)).toBe(true);
	});

	it("separates mistakes from optional improvements and caps the list", () => {
		const f = buildFeedback(base);
		expect(f.couldBeStronger[0]).toMatch(/runtime database storage/);
		expect(f.couldBeStronger.join(" ")).toMatch(/token propagation/);
		expect(f.couldBeStronger.join(" ")).not.toMatch(/governance/); // optional, non-core missing
		expect(f.couldBeStronger.length).toBeLessThanOrEqual(3);
		expect(f.demonstrated).toEqual(["semantic tokens"]);
		expect(f.followUp?.targetsConcept).toBe("token propagation");
	});

	it("an answer with no misconceptions and only optional gaps lists no mistakes", () => {
		const f = buildFeedback({ ...base, misconceptions: [], missing: [{ concept: "governance", criterionId: "x", core: false }], deepen: [] });
		expect(f.couldBeStronger).toEqual([]);
	});

	it("a failed evaluation never yields a score", () => {
		expect(finaliseEvaluation(null, 8, transcript)).toMatchObject({ status: "FAILED" });
		expect(finaliseEvaluation(base, undefined, transcript)).toMatchObject({ status: "FAILED" });
		expect(finaliseEvaluation(base, Number.NaN, transcript)).toMatchObject({ status: "FAILED" });
		const ok = finaliseEvaluation(base, 8, transcript);
		expect(ok.status).toBe("COMPLETED");
	});
});
