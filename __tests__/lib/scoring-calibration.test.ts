import { describe, expect, it } from "vitest";
import { analyzeRepeatedWords, deriveExpectedTerms } from "@/lib/audio-analysis";
import { calculateConcisenessScore, countFillers, countWords } from "@/lib/scoring";
import { CALIBRATION } from "../fixtures/scoring-answers";

/**
 * Regression suite for the deterministic parts of scoring. Required invariants:
 *  - subject vocabulary is never reported as overuse and never lowers conciseness;
 *  - genuine off-topic repetition and genuine filler are still found;
 *  - a correct concise answer is not penalised for being short.
 */
describe.each(CALIBRATION)("calibration: $id", (a) => {
	const terms = deriveExpectedTerms({ text: a.question.text, hint: a.question.hint, tags: a.question.tags });
	const words = countWords(a.transcript);
	const rep = analyzeRepeatedWords(a.transcript, words, terms);

	it("never reports subject vocabulary as overused", () => {
		const reported = rep.repeatedWords.map((r) => r.word);
		for (const w of a.subjectWords) expect(reported).not.toContain(w);
	});

	it("still reports genuine off-topic repetition", () => {
		const reported = rep.repeatedWords.map((r) => r.word);
		for (const w of a.reportedWords) expect(reported).toContain(w);
		if (a.reportedWords.length === 0) expect(rep.hasExcessiveRepetition).toBe(false);
	});

	it("counts genuine filler words exactly", () => {
		expect(countFillers(a.transcript)).toBe(a.fillers);
	});

	it("subject repetition never changes conciseness", () => {
		const without = calculateConcisenessScore(words, a.fillers, a.question.type, true, false);
		const withFlag = calculateConcisenessScore(words, a.fillers, a.question.type, true, rep.hasExcessiveRepetition);
		if (!rep.hasExcessiveRepetition) expect(withFlag).toBe(without);
	});
});

describe("calibration invariants across answers", () => {
	const score = (id: string) => {
		const a = CALIBRATION.find((c) => c.id === id)!;
		const words = countWords(a.transcript);
		const terms = deriveExpectedTerms({ text: a.question.text, hint: a.question.hint, tags: a.question.tags });
		const rep = analyzeRepeatedWords(a.transcript, words, terms);
		return calculateConcisenessScore(words, countFillers(a.transcript), a.question.type, true, rep.hasExcessiveRepetition);
	};

	it("a strong answer with natural terminology repetition scores at least as well as one with genuine filler", () => {
		expect(score("strong-tokens-natural-repetition")).toBeGreaterThanOrEqual(score("genuine-filler"));
	});

	it("a correct concise definition is not marked down for being short", () => {
		expect(score("correct-but-concise")).toBeGreaterThanOrEqual(8);
	});

	it("genuine filler and off-topic padding do cost points", () => {
		expect(score("genuine-filler")).toBeLessThan(score("strong-tokens-natural-repetition"));
		expect(score("off-topic-padding")).toBeLessThan(score("strong-tokens-natural-repetition"));
	});
});
