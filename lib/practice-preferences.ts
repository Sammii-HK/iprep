/**
 * Persistent practice preferences (Tranche A). Local-first and storage-agnostic so the
 * same logic can later sync with canonical account preferences.
 */

import type { LearningContext } from "./learning-context";

export const PRACTICE_PREFS_KEY = "iprep.practicePrefs.v1";

export interface PracticePreset {
	id: string;
	name: string;
	bankIds: string[];
	context: LearningContext;
	mode: string;
	questionCount: number | null;
	minutes: number | null;
}

export interface ResumableSession {
	sessionId: string;
	updatedAt: string;
}

/** Everything remembered per learning context, so switching contexts destroys nothing. */
export interface ContextState {
	/** Banks the learner deliberately chose. Never written by automatic recommendations. */
	selectedBankIds: string[];
	/** Banks the learner deliberately excluded, even if recommended. */
	excludedBankIds: string[];
	/** Recommendations the learner dismissed (still not selections). */
	dismissedBankIds: string[];
	mode: string;
	questionCount: number | null;
	minutes: number | null;
	resume: ResumableSession | null;
}

export interface PracticePrefs {
	version: 2;
	activeContext: LearningContext;
	contexts: Partial<Record<LearningContext, ContextState>>;
	activePresetId: string | null;
	presets: PracticePreset[];
}

export const emptyContextState = (): ContextState => ({
	selectedBankIds: [],
	excludedBankIds: [],
	dismissedBankIds: [],
	mode: "interview",
	questionCount: 5,
	minutes: null,
	resume: null,
});

export const getContextState = (prefs: PracticePrefs, c = prefs.activeContext): ContextState =>
	prefs.contexts[c] ?? emptyContextState();

export const updateContext = (
	prefs: PracticePrefs,
	patch: Partial<ContextState>,
	c: LearningContext = prefs.activeContext,
): PracticePrefs => ({
	...prefs,
	contexts: { ...prefs.contexts, [c]: { ...getContextState(prefs, c), ...patch } },
});

export interface KeyValueStore {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export const DEFAULT_PREFS: PracticePrefs = {
	version: 2,
	activeContext: "INTERVIEW",
	contexts: {},
	activePresetId: null,
	presets: [],
};

const dedupe = (ids: unknown): string[] =>
	Array.isArray(ids) ? [...new Set(ids.filter((i): i is string => typeof i === "string"))] : [];

/** Parse stored JSON defensively; corrupt or foreign data yields defaults, never a throw. */
export function parsePrefs(raw: string | null): PracticePrefs {
	const fresh = (): PracticePrefs => ({ ...DEFAULT_PREFS, contexts: {}, presets: [] });
	if (!raw) return fresh();
	try {
		const p = JSON.parse(raw) as Partial<PracticePrefs>;
		if (!p || p.version !== 2) return fresh();
		const contexts: PracticePrefs["contexts"] = {};
		for (const [k, v] of Object.entries(p.contexts ?? {})) {
			if (!v) continue;
			contexts[k as LearningContext] = {
				...emptyContextState(),
				...v,
				selectedBankIds: dedupe(v.selectedBankIds),
				excludedBankIds: dedupe(v.excludedBankIds),
				dismissedBankIds: dedupe(v.dismissedBankIds),
			};
		}
		return {
			...fresh(),
			activeContext: p.activeContext ?? "INTERVIEW",
			activePresetId: p.activePresetId ?? null,
			contexts,
			presets: Array.isArray(p.presets)
				? p.presets.map((x) => ({ ...x, bankIds: dedupe(x.bankIds) }))
				: [],
		};
	} catch {
		return fresh();
	}
}

export function loadPrefs(store: KeyValueStore): PracticePrefs {
	try {
		return parsePrefs(store.getItem(PRACTICE_PREFS_KEY));
	} catch {
		return { ...DEFAULT_PREFS, contexts: {}, presets: [] };
	}
}

/** Persist immediately; storage failure (private mode, quota) must not break practice. */
export function savePrefs(store: KeyValueStore, prefs: PracticePrefs): boolean {
	try {
		store.setItem(PRACTICE_PREFS_KEY, JSON.stringify(prefs));
		return true;
	} catch {
		return false;
	}
}

export interface ReconcileResult {
	selectedBankIds: string[];
	/** Selected ids that are deleted/archived/unavailable; surfaced, not silently reset. */
	missingBankIds: string[];
}

/**
 * Keep every selection that still exists. Only the missing ones are dropped; we never fall
 * back to "all banks" because some selections vanished.
 */
export function reconcileSelection(
	selected: readonly string[],
	availableBankIds: readonly string[],
): ReconcileResult {
	const available = new Set(availableBankIds);
	return {
		selectedBankIds: selected.filter((id) => available.has(id)),
		missingBankIds: selected.filter((id) => !available.has(id)),
	};
}

export function savePreset(prefs: PracticePrefs, name: string, id: string): PracticePrefs {
	const trimmed = name.trim();
	if (!trimmed) return prefs;
	const cs = getContextState(prefs);
	const preset: PracticePreset = {
		id,
		name: trimmed,
		bankIds: [...cs.selectedBankIds],
		context: prefs.activeContext,
		mode: cs.mode,
		questionCount: cs.questionCount,
		minutes: cs.minutes,
	};
	const idx = prefs.presets.findIndex(
		(p) => p.id === id || p.name.toLowerCase() === trimmed.toLowerCase(),
	);
	const presets = [...prefs.presets];
	if (idx >= 0) presets[idx] = { ...preset, id: presets[idx].id };
	else presets.push(preset);
	const saved = idx >= 0 ? presets[idx] : preset;
	return { ...prefs, presets, activePresetId: saved.id };
}

export function applyPreset(prefs: PracticePrefs, presetId: string): PracticePrefs {
	const preset = prefs.presets.find((p) => p.id === presetId);
	if (!preset) return prefs;
	const next = updateContext(
		{ ...prefs, activeContext: preset.context },
		{
			selectedBankIds: [...preset.bankIds],
			mode: preset.mode,
			questionCount: preset.questionCount,
			minutes: preset.minutes,
		},
		preset.context,
	);
	return { ...next, activePresetId: preset.id };
}

export function deletePreset(prefs: PracticePrefs, presetId: string): PracticePrefs {
	return {
		...prefs,
		presets: prefs.presets.filter((p) => p.id !== presetId),
		activePresetId: prefs.activePresetId === presetId ? null : prefs.activePresetId,
	};
}

/** Switching context only changes which remembered state is active; nothing is reset. */
export function switchContext(prefs: PracticePrefs, context: LearningContext): PracticePrefs {
	return { ...prefs, activeContext: context, activePresetId: null };
}

/** Manual edits detach from the preset but never discard the selection itself. */
export function setSelection(prefs: PracticePrefs, bankIds: readonly string[]): PracticePrefs {
	return {
		...updateContext(prefs, { selectedBankIds: dedupe(bankIds) }),
		activePresetId: null,
	};
}

export function excludeBank(prefs: PracticePrefs, bankId: string): PracticePrefs {
	const cs = getContextState(prefs);
	return updateContext(prefs, {
		excludedBankIds: dedupe([...cs.excludedBankIds, bankId]),
		selectedBankIds: cs.selectedBankIds.filter((b) => b !== bankId),
	});
}

export function dismissRecommendation(prefs: PracticePrefs, bankId: string): PracticePrefs {
	const cs = getContextState(prefs);
	return updateContext(prefs, { dismissedBankIds: dedupe([...cs.dismissedBankIds, bankId]) });
}

/** Accepting copies a recommendation into the manual selection, explicitly. */
export function acceptRecommendation(prefs: PracticePrefs, bankId: string): PracticePrefs {
	const cs = getContextState(prefs);
	return setSelection(prefs, [...cs.selectedBankIds, bankId]);
}

/**
 * Recommended-for-this-interview list: kept apart from the manual selection. Already
 * selected, excluded and dismissed banks are not re-suggested; the selection is untouched.
 */
export function visibleRecommendations(
	prefs: PracticePrefs,
	recommendedBankIds: readonly string[],
): string[] {
	const cs = getContextState(prefs);
	const hidden = new Set([...cs.selectedBankIds, ...cs.excludedBankIds, ...cs.dismissedBankIds]);
	return dedupe(recommendedBankIds).filter((id) => !hidden.has(id));
}

export function setResume(prefs: PracticePrefs, sessionId: string | null, now: Date): PracticePrefs {
	return updateContext(prefs, {
		resume: sessionId ? { sessionId, updatedAt: now.toISOString() } : null,
	});
}
