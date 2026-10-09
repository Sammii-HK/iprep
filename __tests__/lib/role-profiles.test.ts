import { describe, expect, it } from "vitest";
import { interviewWeight, matchRoles, recommendBanks, selectionTerms } from "@/lib/role-profiles";

const now = new Date("2026-10-09T12:00:00Z");
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);

const banks = [
	{ id: "ds", title: "Design systems", sampleQuestions: ["Explain design tokens", "How do you keep a component library accessible?"] },
	{ id: "react", title: "React deep dive", sampleQuestions: ["Explain React rendering", "TypeScript with React"] },
	{ id: "ai", title: "AI orchestration", sampleQuestions: ["What is MCP?", "How do agents use tool calling?"] },
	{ id: "vc", title: "Fundraising and investors", sampleQuestions: ["How do you negotiate valuation with investors?"] },
	{ id: "css", title: "CSS", sampleQuestions: ["Grid vs flexbox"] },
];

describe("role profiles", () => {
	it("matches titles loosely without exact matching", () => {
		expect(matchRoles("Senior Product Engineer").map((r) => r.id)).toContain("product-engineer");
		expect(matchRoles("Staff Design Engineer, Growth").map((r) => r.id)).toContain("design-engineer");
		expect(matchRoles("AI Product Engineer").map((r) => r.id)).toEqual(expect.arrayContaining(["ai-product-engineer", "product-engineer"]));
	});

	it("covers overlapping roles with each bank listed once", () => {
		const recs = recommendBanks({
			targetRoleTitles: ["Senior Design Engineer", "Senior Product Engineer", "Frontend Engineer"],
			interviews: [],
			banks,
			activeContext: "INTERVIEW",
			now,
		});
		const ids = recs.map((r) => r.bankId);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toEqual(expect.arrayContaining(["ds", "react"]));
		expect(ids).not.toContain("vc"); // fundraising never leaks into Interview
	});

	it("Founder context recommends fundraising banks only for that context", () => {
		const ids = recommendBanks({ targetRoleTitles: ["Founder"], interviews: [], banks, activeContext: "FUNDRAISING", now }).map((r) => r.bankId);
		expect(ids).toEqual([]); // no role skills match; nothing invented
	});

	it("an upcoming interview raises relevant banks, explains why, and expires after it passes", () => {
		const interview = { company: "Prismic", role: "Senior Product Engineer", startsAt: inDays(2) };
		const before = recommendBanks({ targetRoleTitles: ["Design Engineer"], interviews: [], banks, activeContext: "INTERVIEW", now });
		const during = recommendBanks({ targetRoleTitles: ["Design Engineer"], interviews: [interview], banks, activeContext: "INTERVIEW", now });
		const after = recommendBanks({ targetRoleTitles: ["Design Engineer"], interviews: [{ ...interview, startsAt: inDays(-1) }], banks, activeContext: "INTERVIEW", now });
		expect(during.find((r) => r.bankId === "react")!.score).toBeGreaterThan(before.find((r) => r.bankId === "react")?.score ?? 0);
		expect(during.find((r) => r.bankId === "react")!.reasons.join(" ")).toMatch(/Prismic/);
		// Design-engineering preparation is preserved throughout.
		expect(during.map((r) => r.bankId)).toContain("ds");
		expect(after).toEqual(before);
	});

	it("interview weight ramps up, and cancelled or past interviews weigh nothing", () => {
		const i = (d: number, status = "scheduled") => ({ company: "X", role: "Y", startsAt: inDays(d), status });
		expect(interviewWeight(i(1), now)).toBeGreaterThan(interviewWeight(i(10), now));
		expect(interviewWeight(i(30), now)).toBe(0);
		expect(interviewWeight(i(-1), now)).toBe(0);
		expect(interviewWeight(i(1, "cancelled"), now)).toBe(0);
	});

	it("provides terms for question selection", () => {
		const t = selectionTerms({ targetRoleTitles: ["AI Product Engineer"], interviews: [{ company: "Prismic", role: "Product Engineer", startsAt: inDays(3) }], now });
		expect(t.roleTerms).toContain("mcp");
		expect(t.interviewTerms).toContain("prismic");
	});
});
