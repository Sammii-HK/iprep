import { describe, expect, it } from "vitest";
import { assessReadiness, planToday, type ReadinessInput } from "@/lib/readiness";

const now = new Date("2026-10-09T12:00:00Z");
const att = (kind: ReadinessInput["evaluatedAttempts"][number]["kind"], score: number, d = 1, delivery?: number) => ({ at: new Date(now.getTime() - d * 86_400_000), kind, score, delivery });

describe("readiness", () => {
	it("sparse evidence yields insufficient evidence and no precise percentage", () => {
		const r = assessReadiness({ concepts: ["PRACTISING", "EXPOSED", "NOT_ENCOUNTERED"], evaluatedAttempts: [att("RECALL", 9)], storyCount: 0, now });
		expect(r.confidence).toBe("INSUFFICIENT_EVIDENCE");
		expect(JSON.stringify(r)).not.toMatch(/\d+%/);
		expect(r.disclaimer).toMatch(/does not predict/);
		expect(r.focus.length).toBeGreaterThan(0);
	});

	it("builds confidence from varied, recent, evaluated evidence", () => {
		const attempts = [
			...Array.from({ length: 3 }, (_, i) => att("RECALL", 8, i, 8)),
			...Array.from({ length: 3 }, (_, i) => att("EXPLANATION", 7, i, 7)),
			...Array.from({ length: 3 }, (_, i) => att("APPLICATION", 7, i, 7)),
		];
		const r = assessReadiness({ concepts: ["DEMONSTRATED", "DEVELOPING", "DEVELOPING", "PRACTISING"], evaluatedAttempts: attempts, storyCount: 4, now });
		expect(["MODERATE", "GOOD"]).toContain(r.confidence);
		expect(r.dimensions.find((d) => d.dimension === "recall")?.level).toBe("HIGH");
		expect(r.dimensions.find((d) => d.dimension === "recall")?.evidence).toMatch(/3 evaluated/);
	});
});

describe("Today plan", () => {
	const base = { minutesAvailable: 10, dueCount: 20, unseenCount: 50, weakConceptCount: 3, storyCount: 2, upcomingInterview: null, answeredToday: 0 };

	it("sizes the session to available time without requiring a full plan", () => {
		expect(planToday({ ...base, minutesAvailable: 6 }).total).toBeLessThanOrEqual(3);
		expect(planToday({ ...base, minutesAvailable: 2 }).total).toBeGreaterThanOrEqual(1);
	});

	it("adapts proportions to what exists", () => {
		const p = planToday({ ...base, dueCount: 0, minutesAvailable: 20 });
		expect(p.mix.due).toBe(0);
		expect(p.mix.unseen + p.mix.weak).toBeGreaterThan(0);
	});

	it("shifts toward weak areas and application right before an interview, naming it", () => {
		const normal = planToday({ ...base, minutesAvailable: 20 });
		const soon = planToday({ ...base, minutesAvailable: 20, upcomingInterview: { company: "Prismic", role: "Product Engineer", daysAway: 1 } });
		expect(soon.mix.weak).toBeGreaterThan(normal.mix.weak);
		expect(soon.headline).toMatch(/Prismic/);
	});

	it("never punishes: rest days and prior activity are gentle", () => {
		expect(planToday({ ...base, restDay: true }).total).toBe(0);
		expect(planToday({ ...base, answeredToday: 3 }).notes.join(" ")).toMatch(/bonus/);
	});
});
