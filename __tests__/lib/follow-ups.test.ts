import { describe, expect, it } from "vitest";
import { followUpsFromMissed, gist } from "@/lib/follow-ups";

describe("follow-ups", () => {
	it("asks only about what was missed, capped, in the persona's voice", () => {
		const qs = followUpsFromMissed(["A CDN places copies close to users", "Idempotency keys make retries safe", "Third point"], "Zac");
		expect(qs.map((q) => q.target)).toEqual(["A CDN places copies close to users", "Idempotency keys make retries safe"]);
		expect(qs[0].question.startsWith("Zac:")).toBe(true);
	});
	it("ignores blanks and duplicates, and has nothing to ask when nothing was missed", () => {
		expect(followUpsFromMissed(["", "  ", "Same", "same"]).map((q) => q.target)).toEqual(["Same"]);
		expect(followUpsFromMissed([])).toEqual([]);
	});
	it("shortens long points without cutting a word", () => {
		const g = gist("word ".repeat(40));
		expect(g.endsWith("…")).toBe(true);
		expect(g.length).toBeLessThanOrEqual(81);
	});
});
