import { describe, expect, it } from "vitest";
import { bossesFor, buildChallenge, celebrationFor, levelFor, seasonFor, teachBackQuestions, xpFor } from "@/lib/engagement";

describe("XP", () => {
	it("rewards difficult retrieval after a gap and improving weak concepts", () => {
		const easy = xpFor({ kind: "ANSWER", score: 8, difficulty: 1 });
		const hardLater = xpFor({ kind: "ANSWER", score: 8, difficulty: 4, daysSinceLastCorrect: 10 });
		const repaired = xpFor({ kind: "ANSWER", score: 8, difficulty: 1, improvedWeakConcept: true });
		expect(hardLater).toBeGreaterThan(easy);
		expect(repaired).toBeGreaterThan(easy);
	});
	it("gives nothing for failed evaluations or same-day repetition, and little for listening", () => {
		expect(xpFor({ kind: "ANSWER", score: null })).toBe(0);
		expect(xpFor({ kind: "ANSWER", score: Number.NaN })).toBe(0);
		expect(xpFor({ kind: "ANSWER", score: 9, repeatToday: true })).toBe(0);
		expect(xpFor({ kind: "LISTEN" })).toBeLessThanOrEqual(1);
	});
	it("levels progress and eventually cap", () => {
		expect(levelFor(0).level).toBe(1);
		expect(levelFor(160).level).toBe(3);
		expect(levelFor(99999).toNext).toBeNull();
	});
});

describe("challenges and bosses", () => {
	it("every challenge declares the evidence it produces; no-jargon lifts the terminology rule", () => {
		const c = buildChallenge("NO_JARGON", "design tokens");
		expect(c.evidenceKind).toBe("EXPLANATION");
		expect(c.rubricNote).toMatch(/avoiding specialist terms/);
		expect(buildChallenge("THIRTY_SECONDS", "x").timeLimitSeconds).toBe(30);
		expect(buildChallenge("CONNECT_TWO", "a", "b").prompt).toMatch(/b/);
	});
	it("bosses stay inside their context", () => {
		expect(bossesFor("INTERVIEW").every((b) => b.context === "INTERVIEW")).toBe(true);
		expect(bossesFor("INTERVIEW").map((b) => b.id)).not.toContain("founder-pitch");
		expect(bossesFor("FOUNDER").map((b) => b.id)).toContain("founder-pitch");
	});
	it("teach-back probes gaps without inventing facts", () => {
		const qs = teachBackQuestions(["semantic tokens"], ["token propagation", "versioning", "governance"], "Jess");
		expect(qs).toHaveLength(3);
		expect(qs[0]).toMatch(/token propagation/);
		expect(qs.join(" ")).not.toMatch(/governance/);
	});
});

describe("celebrations", () => {
	it("are seasonal, occasional and respect Reduce Motion", () => {
		expect(seasonFor(new Date("2026-10-31T12:00:00Z"))).toBe("HALLOWEEN");
		expect(seasonFor(new Date("2026-12-25T12:00:00Z"))).toBe("WINTER");
		expect(celebrationFor({ meaningful: false }, new Date("2026-10-31T00:00:00Z"), false)).toBeNull();
		const c = celebrationFor({ meaningful: true }, new Date("2026-10-31T00:00:00Z"), true)!;
		expect(c.motion).toBe("STATIC");
		expect(c.particles).toContain("pumpkin");
	});
});
