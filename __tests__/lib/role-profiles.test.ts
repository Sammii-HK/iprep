import { describe, expect, it } from "vitest";
import { interviewWeight, matchRoles, recommendBanks, recommendForInterview, selectionTerms } from "@/lib/role-profiles";

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

describe("recommendForInterview", () => {
	const next = {
		interview: { company: "Prismic", role: "Senior Product Engineer", startsAt: inDays(2).toISOString() },
		folder: { title: "Prismic Interview Prep", banks: [{ id: "react" }, { id: "gone" }] },
	};

	it("puts the interview's own prep folder first, explains why, and skips banks that no longer exist", () => {
		const recs = recommendForInterview({ next, banks, activeContext: "INTERVIEW", now });
		expect(recs[0]).toEqual({ id: "react", reason: "In your Prismic prep folder" });
		expect(recs.map((r) => r.id)).not.toContain("gone");
		expect(new Set(recs.map((r) => r.id)).size).toBe(recs.length);
	});

	it("never re-suggests selected, excluded or dismissed banks, and has nothing without an interview", () => {
		const recs = recommendForInterview({ next, banks, activeContext: "INTERVIEW", now, exclude: new Set(["react", "ds"]) });
		expect(recs.map((r) => r.id)).not.toEqual(expect.arrayContaining(["react"]));
		expect(recs.map((r) => r.id)).not.toContain("ds");
		expect(recommendForInterview({ next: null, banks, activeContext: "INTERVIEW", now })).toEqual([]);
	});

	it("does not suggest fundraising banks for an interview", () => {
		const recs = recommendForInterview({ next, banks, activeContext: "INTERVIEW", now });
		expect(recs.map((r) => r.id)).not.toContain("vc");
	});

	it("target roles alone drive suggestions, covering overlapping skills once, with no interview", () => {
		const recs = recommendForInterview({ next: null, banks, activeContext: "INTERVIEW", now, targetRoles: ["Senior Design Engineer", "AI Product Engineer"] });
		const ids = recs.map((r) => r.id);
		expect(ids).toEqual(expect.arrayContaining(["ds", "ai"]));
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).not.toContain("vc");
	});

	it("an interview adds to the learner's broader targets instead of replacing them", () => {
		const recs = recommendForInterview({ next, banks, activeContext: "INTERVIEW", now, targetRoles: ["Design Engineer"] });
		expect(recs.map((r) => r.id)).toEqual(expect.arrayContaining(["react", "ds"]));
	});

	it("without an interview or target roles there is nothing to suggest", () => {
		expect(recommendForInterview({ next: null, banks, activeContext: "INTERVIEW", now })).toEqual([]);
	});
});
