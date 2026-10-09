import { describe, expect, it } from "vitest";
import {
	acceptRecommendation,
	addTargetRole,
	removeTargetRole,
	applyPreset,
	dismissRecommendation,
	excludeBank,
	getContextState,
	setResume,
	switchContext,
	visibleRecommendations,
	loadPrefs,
	parsePrefs,
	reconcileSelection,
	savePreset,
	savePrefs,
	setSelection,
	type KeyValueStore,
} from "@/lib/practice-preferences";

const memoryStore = (): KeyValueStore & { data: Map<string, string> } => {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v),
	};
};

describe("practice preferences", () => {
	it("restores the same banks after an app restart", () => {
		const store = memoryStore();
		const prefs = setSelection(loadPrefs(store), ["a", "b", "c"]);
		savePrefs(store, prefs);
		// "restart": a brand new load from the same storage
		expect(getContextState(loadPrefs(store)).selectedBankIds).toEqual(["a", "b", "c"]);
	});

	it("drops only missing banks, never resetting the rest", () => {
		const r = reconcileSelection(["a", "b", "c"], ["a", "c", "z"]);
		expect(r.selectedBankIds).toEqual(["a", "c"]);
		expect(r.missingBankIds).toEqual(["b"]);
	});

	it("survives corrupt storage and storage failure", () => {
		expect(getContextState(parsePrefs("{not json")).selectedBankIds).toEqual([]);
		const failing: KeyValueStore = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("quota");
			},
		};
		expect(getContextState(loadPrefs(failing)).selectedBankIds).toEqual([]);
		expect(savePrefs(failing, loadPrefs(memoryStore()))).toBe(false);
	});

	it("saves and switches named presets", () => {
		let prefs = setSelection(loadPrefs(memoryStore()), ["a", "b"]);
		prefs = savePreset(prefs, "Senior frontend", "p1");
		prefs = setSelection(switchContext(prefs, "FOUNDER"), ["x"]);
		prefs = savePreset(prefs, "Founder preparation", "p2");

		const back = applyPreset(prefs, "p1");
		expect(getContextState(back).selectedBankIds).toEqual(["a", "b"]);
		expect(back.activeContext).toBe("INTERVIEW");
		expect(back.activePresetId).toBe("p1");
	});

	it("re-saving a preset name updates it instead of duplicating", () => {
		let prefs = savePreset(setSelection(loadPrefs(memoryStore()), ["a"]), "Mine", "p1");
		prefs = savePreset(setSelection(prefs, ["a", "b"]), "mine", "p9");
		expect(prefs.presets).toHaveLength(1);
		expect(prefs.presets[0].bankIds).toEqual(["a", "b"]);
	});

	it("switching contexts preserves each context's selection", () => {
		let prefs = setSelection(loadPrefs(memoryStore()), ["react", "ts", "sysdesign"]);
		prefs = setSelection(switchContext(prefs, "FOUNDER"), ["fundraising", "pitching"]);
		prefs = switchContext(prefs, "INTERVIEW");
		expect(getContextState(prefs).selectedBankIds).toEqual(["react", "ts", "sysdesign"]);
		expect(getContextState(prefs, "FOUNDER").selectedBankIds).toEqual(["fundraising", "pitching"]);
	});

	it("recommendations never override or merge into manual selection", () => {
		let prefs = setSelection(loadPrefs(memoryStore()), ["react", "ts"]);
		const recs = ["react", "design-systems", "ai"];
		expect(visibleRecommendations(prefs, recs)).toEqual(["design-systems", "ai"]);
		// A new interview changes recommendations; selection is unchanged.
		expect(getContextState(prefs).selectedBankIds).toEqual(["react", "ts"]);
		prefs = dismissRecommendation(prefs, "ai");
		expect(visibleRecommendations(prefs, recs)).toEqual(["design-systems"]);
		prefs = acceptRecommendation(prefs, "design-systems");
		expect(getContextState(prefs).selectedBankIds).toEqual(["react", "ts", "design-systems"]);
	});

	it("exclusions remove from selection and hide recommendations", () => {
		let prefs = setSelection(loadPrefs(memoryStore()), ["a", "b"]);
		prefs = excludeBank(prefs, "b");
		expect(getContextState(prefs).selectedBankIds).toEqual(["a"]);
		expect(visibleRecommendations(prefs, ["b", "c"])).toEqual(["c"]);
	});

	it("remembers a resumable session per context across restart", () => {
		const store = memoryStore();
		let prefs = setResume(loadPrefs(store), "s1", new Date("2026-10-09T10:00:00Z"));
		prefs = switchContext(prefs, "FOUNDER");
		savePrefs(store, prefs);
		const back = loadPrefs(store);
		expect(getContextState(back, "INTERVIEW").resume?.sessionId).toBe("s1");
		expect(getContextState(back, "FOUNDER").resume).toBeNull();
	});

	it("keeps several target roles across a restart, ignoring blanks and case-only duplicates", () => {
		const store = memoryStore();
		let prefs = loadPrefs(store);
		for (const r of ["Senior Design Engineer", "  senior design   engineer ", "", "AI Product Engineer"]) prefs = addTargetRole(prefs, r);
		savePrefs(store, prefs);
		expect(loadPrefs(store).targetRoles).toEqual(["Senior Design Engineer", "AI Product Engineer"]);
		expect(removeTargetRole(loadPrefs(store), "ai product engineer").targetRoles).toEqual(["Senior Design Engineer"]);
	});
});
