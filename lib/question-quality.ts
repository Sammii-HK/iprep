/**
 * Question-quality classification and duplicate grouping. Pure heuristics that produce a
 * reviewable audit; nothing here deletes or edits a question.
 */

import { inferContexts, isAdministrativeQuestion, type LearningContext } from "./learning-context";

export const QUESTION_CLASSES = [
	"LEARNING",
	"BEHAVIOURAL",
	"SCENARIO",
	"ADMINISTRATIVE",
	"PERSONAL_STORY",
	"FOUNDER",
	"FUNDRAISING",
	"DUPLICATE_CANDIDATE",
	"OUTDATED",
	"NEEDS_REVIEW",
] as const;
export type QuestionClass = (typeof QUESTION_CLASSES)[number];

export const AUDIT_ACTIONS = [
	"KEEP",
	"IMPROVE",
	"RECLASSIFY",
	"EXCLUDE_FROM_PRACTICE",
	"ARCHIVE",
	"DELETE_CANDIDATE",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditInput {
	id: string;
	bank: string;
	text: string;
	hint?: string | null;
	tags?: readonly string[];
}

export interface AuditRow {
	id: string;
	bank: string;
	text: string;
	classification: QuestionClass;
	issues: string[];
	action: AuditAction;
	contexts: LearningContext[];
	/** Other question ids in the same near-duplicate group, if any. */
	duplicateOf: string[];
	spokenSuitable: boolean;
}

const BEHAVIOURAL = /\b(tell me about a time|describe a time|give (me )?an example of a time|walk me through a time|a time (when )?you)\b/i;
const SCENARIO = /\b(how would you|what would you do|imagine|suppose|given a scenario|design a|you are asked to)\b/i;
const PERSONAL = /\b(your (experience|background|journey|story)|about yourself|your biggest (achievement|failure)|a project you)\b/i;
const FUNDRAISING = /\b(fundrais\w*|valuation|term sheet|cap table|investor\w*|venture capital|seed round|series [a-c]|dilution)\b/i;
const FOUNDER = /\b(startup|founder|product-?market fit|go-?to-?market|business model|unit economics)\b/i;
const OUTDATED = /\b(internet explorer|\bie ?(6|7|8|9|10|11)\b|flash|jquery|angularjs|componentwillmount|createclass|enzyme|moment\.js|bower|grunt)\b/i;
const VAGUE = /^(tell me (about|more)|what do you think|thoughts on|anything else|explain)\b[^.?]{0,20}[.?]?$/i;

const tokens = (t: string) =>
	new Set(
		t
			.toLowerCase()
			.replace(/[^\w\s]/g, " ")
			.split(/\s+/)
			.filter((w) => w.length > 3),
	);

function jaccard(a: Set<string>, b: Set<string>) {
	if (!a.size || !b.size) return 0;
	let shared = 0;
	for (const w of a) if (b.has(w)) shared++;
	return shared / (a.size + b.size - shared);
}

export function classifyQuestion(q: AuditInput): Omit<AuditRow, "duplicateOf"> {
	const text = q.text.trim();
	const issues: string[] = [];
	const contexts = inferContexts({ title: q.bank, text, tags: q.tags });
	const words = text.split(/\s+/).filter(Boolean).length;

	let classification: QuestionClass = "LEARNING";
	let action: AuditAction = "KEEP";

	if (isAdministrativeQuestion(text)) {
		classification = "ADMINISTRATIVE";
		action = "EXCLUDE_FROM_PRACTICE";
		issues.push("Recruiter logistics, not knowledge retrieval");
	} else if (FUNDRAISING.test(text)) {
		classification = "FUNDRAISING";
		action = "RECLASSIFY";
		issues.push("Fundraising content: keep for Fundraising context, hide from Interview");
	} else if (FOUNDER.test(text) && !/\breact|typescript|css\b/i.test(text)) {
		classification = "FOUNDER";
		action = "RECLASSIFY";
		issues.push("Founder content: keep for Founder context");
	} else if (OUTDATED.test(text)) {
		classification = "OUTDATED";
		action = "IMPROVE";
		issues.push("References technology that is likely outdated");
	} else if (BEHAVIOURAL.test(text)) {
		classification = "BEHAVIOURAL";
	} else if (PERSONAL.test(text)) {
		classification = "PERSONAL_STORY";
	} else if (SCENARIO.test(text)) {
		classification = "SCENARIO";
	}

	if (classification === "LEARNING" || classification === "SCENARIO") {
		if (words < 4 || VAGUE.test(text)) {
			classification = "NEEDS_REVIEW";
			action = "IMPROVE";
			issues.push("Too vague to evaluate fairly");
		} else if (words > 60) {
			classification = "NEEDS_REVIEW";
			action = "IMPROVE";
			issues.push("Very long; consider splitting into separate questions");
		}
		if (/\b(and|also)\b.*\?.*\b(and|also)\b.*\?/i.test(text) || (text.match(/\?/g) ?? []).length > 2) {
			if (action === "KEEP") action = "IMPROVE";
			issues.push("Asks several things at once; consider splitting");
		}
	}

	if (!q.hint || q.hint.trim().length < 15) {
		if (action === "KEEP") action = "IMPROVE";
		issues.push("Missing or very thin reference answer");
	}

	// Heavily multi-part or very long questions are hard to answer aloud.
	const spokenSuitable = classification !== "ADMINISTRATIVE" && words <= 40;

	return {
		id: q.id,
		bank: q.bank,
		text,
		classification,
		issues,
		action,
		contexts,
		spokenSuitable,
	};
}

/** Group near-duplicates (>= threshold token overlap) across banks. Never merges anything. */
export function findDuplicateGroups(
	items: readonly AuditInput[],
	threshold = 0.75,
): Map<string, string[]> {
	const sigs = items.map((i) => ({ id: i.id, t: tokens(i.text) }));
	const groups = new Map<string, string[]>();
	for (let i = 0; i < sigs.length; i++) {
		for (let j = i + 1; j < sigs.length; j++) {
			if (jaccard(sigs[i].t, sigs[j].t) >= threshold) {
				groups.set(sigs[i].id, [...(groups.get(sigs[i].id) ?? []), sigs[j].id]);
				groups.set(sigs[j].id, [...(groups.get(sigs[j].id) ?? []), sigs[i].id]);
			}
		}
	}
	return groups;
}

export function auditQuestions(items: readonly AuditInput[]): AuditRow[] {
	const dupes = findDuplicateGroups(items);
	return items.map((item) => {
		const row = classifyQuestion(item);
		const duplicateOf = dupes.get(item.id) ?? [];
		if (duplicateOf.length > 0) {
			row.issues.push(`Near-duplicate of ${duplicateOf.length} other question(s)`);
			// Only the later member of a pair is flagged; the first stays as the canonical one.
			const earlier = duplicateOf.some((d) => items.findIndex((x) => x.id === d) < items.findIndex((x) => x.id === item.id));
			if (earlier && row.action === "KEEP") {
				row.classification = "DUPLICATE_CANDIDATE";
				row.action = "ARCHIVE";
			}
		}
		return { ...row, duplicateOf };
	});
}

export function summariseAudit(rows: readonly AuditRow[]) {
	const byClass: Record<string, number> = {};
	const byAction: Record<string, number> = {};
	for (const r of rows) {
		byClass[r.classification] = (byClass[r.classification] ?? 0) + 1;
		byAction[r.action] = (byAction[r.action] ?? 0) + 1;
	}
	return { total: rows.length, byClass, byAction };
}
