import { describe, expect, it } from "vitest";
import { analyzeRepeatedWords, deriveExpectedTerms } from "@/lib/audio-analysis";
import { calculateConcisenessScore, countWords } from "@/lib/scoring";

const question = {
	text: "Explain design tokens in a design system.",
	hint: "Primitive, semantic and component tokens.",
	tags: ["design-systems"],
};

// Deterministic fixtures: a correct answer that naturally repeats "tokens".
const tokensAnswer =
	"Design tokens are named values for colour and spacing. Primitive tokens hold raw values, " +
	"semantic tokens give them meaning like danger, and component tokens scope decisions per component. " +
	"Changing a token propagates everywhere tokens are consumed, which keeps the system consistent.";

describe("terminology repetition (regression)", () => {
	const terms = deriveExpectedTerms(question);

	it("does not flag subject vocabulary as overuse", () => {
		const r = analyzeRepeatedWords(tokensAnswer, countWords(tokensAnswer), terms);
		expect(r.hasExcessiveRepetition).toBe(false);
		expect(r.repeatedWords.map((w) => w.word)).not.toContain("tokens");
	});

	it("documents the old behaviour: without expected terms it would flag them", () => {
		const r = analyzeRepeatedWords(tokensAnswer, countWords(tokensAnswer));
		expect(r.repeatedWords.map((w) => w.word)).toContain("tokens");
	});

	it("does not reduce conciseness for natural technical repetition", () => {
		const n = countWords(tokensAnswer);
		const r = analyzeRepeatedWords(tokensAnswer, n, terms);
		expect(calculateConcisenessScore(n, 0, "TECHNICAL", true, r.hasExcessiveRepetition)).toBe(
			calculateConcisenessScore(n, 0, "TECHNICAL", true, false),
		);
	});

	it("still flags genuine non-topic repetition", () => {
		const padded =
			"Basically it is really really really good and really really useful because it is really good. " +
			"Really good tokens, really good.";
		const n = countWords(padded);
		const r = analyzeRepeatedWords(padded, n, terms);
		expect(r.hasExcessiveRepetition).toBe(true);
		expect(r.repeatedWords.map((w) => w.word)).toContain("really");
	});

	it("matches inflections by stem", () => {
		const a = "Token token token token token token. A token is a named value.";
		expect(analyzeRepeatedWords(a, countWords(a), ["tokens"]).repeatedWords).toHaveLength(0);
	});
});
