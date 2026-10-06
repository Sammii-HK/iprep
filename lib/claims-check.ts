/**
 * Deterministic claims check (no LLM).
 *
 * Finds statements in a spoken answer that carry a figure (number, percentage,
 * currency amount, count such as "14 agents", multiplier) or a strong claim
 * (for example "doubled", "single-handedly"), and reports the ones that are
 * not supported by the user's fact sheet.
 *
 * "Not in your record" means unverified, not wrong. The check is deliberately
 * conservative about wording: it normalises number formats (1,000 / 1000 /
 * 1k / "one thousand") and matches counts to their noun ("14 agents"), but it
 * never judges whether a claim is true.
 */

export const CLAIMS_LABEL = "not in your record";

export type ClaimKind = "number" | "percentage" | "currency" | "count" | "claim";

export interface ClaimItem {
	/** The sentence from the answer that contains the unsupported figure or claim. */
	statement: string;
	/** The figures or phrases within the sentence that were not found in the record. */
	flagged: string[];
	kinds: ClaimKind[];
}

export interface ClaimsCheck {
	label: typeof CLAIMS_LABEL;
	items: ClaimItem[];
}

export interface Mention {
	raw: string;
	value: number;
	start: number;
	end: number;
	kind: ClaimKind;
	/** Nouns (stems) adjacent to the figure, used to match "14 agents" to the record. */
	nouns: string[];
	/** Whether this mention is worth flagging when unsupported. */
	checkable: boolean;
}

const MAX_ITEMS = 8;
const MAX_STATEMENT_CHARS = 220;

// ---------------------------------------------------------------------------
// Number parsing
// ---------------------------------------------------------------------------

const UNIT_WORDS: Record<string, number> = {
	zero: 0,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
	eleven: 11,
	twelve: 12,
	thirteen: 13,
	fourteen: 14,
	fifteen: 15,
	sixteen: 16,
	seventeen: 17,
	eighteen: 18,
	nineteen: 19,
};
const TENS_WORDS: Record<string, number> = {
	twenty: 20,
	thirty: 30,
	forty: 40,
	fifty: 50,
	sixty: 60,
	seventy: 70,
	eighty: 80,
	ninety: 90,
};
const SCALE_WORDS: Record<string, number> = {
	hundred: 100,
	thousand: 1_000,
	million: 1_000_000,
	billion: 1_000_000_000,
	k: 1_000,
	m: 1_000_000,
	bn: 1_000_000_000,
};

// "one" is left out of bare detection (too common: "one of the", "one thing"),
// but is accepted as part of "one hundred", "one thousand", "twenty one".
const TENS = Object.keys(TENS_WORDS).join("|");
const BARE_WORD = Object.keys({ ...UNIT_WORDS, ...TENS_WORDS }).join("|");
const WORD_NUMBER_SRC = [
	String.raw`(?:a|one)\s+(?:hundred|thousand|million|billion|dozen)`,
	String.raw`(?:${TENS})(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?(?:\s+(?:hundred|thousand|million))?`,
	String.raw`(?:${BARE_WORD})(?:\s+(?:hundred|thousand|million|billion))?`,
	String.raw`dozens?`,
].join("|");

const DIGIT_SRC = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;

function parseDigits(raw: string): number {
	return Number(raw.replace(/,/g, ""));
}

export function parseWordNumber(text: string): number | null {
	const t = text.toLowerCase().trim();
	if (t === "dozens") return null;
	const tokens = t.split(/[\s-]+/);
	let total = 0;
	let current = 0;
	let seen = false;
	for (const tok of tokens) {
		if (tok === "a" || tok === "one") {
			current += 1;
			seen = true;
		} else if (tok === "dozen") {
			current = (current || 1) * 12;
			seen = true;
		} else if (tok in UNIT_WORDS) {
			current += UNIT_WORDS[tok];
			seen = true;
		} else if (tok in TENS_WORDS) {
			current += TENS_WORDS[tok];
			seen = true;
		} else if (tok === "hundred") {
			current = (current || 1) * 100;
			seen = true;
		} else if (tok in SCALE_WORDS) {
			total += (current || 1) * SCALE_WORDS[tok];
			current = 0;
			seen = true;
		} else {
			return null;
		}
	}
	return seen ? total + current : null;
}

// ---------------------------------------------------------------------------
// Mention extraction
// ---------------------------------------------------------------------------

const STOP_AFTER = new Set([
	"of", "to", "the", "and", "or", "a", "an", "in", "on", "at", "for", "from",
	"with", "by", "as", "is", "was", "were", "are", "be", "been", "that", "which",
	"it", "i", "we", "so", "but", "then", "than", "out", "up", "down", "over",
	"into", "about", "when", "while", "my", "our", "their", "this", "these",
	"those", "if", "not", "no", "also", "just", "very", "really", "all", "some",
	"other", "more", "most", "each", "per",
]);

const UNIT_NOUNS = new Set([
	"ms", "s", "sec", "secs", "second", "seconds", "minute", "minutes", "min",
	"mins", "hour", "hours", "day", "days", "week", "weeks", "month", "months",
	"year", "years", "kb", "mb", "gb", "tb", "px",
]);

const CURRENCY_WORDS = new Set([
	"pounds", "pound", "dollars", "dollar", "euros", "euro", "quid", "gbp",
	"usd", "eur", "grand",
]);

const MONTHS = new Set([
	"january", "february", "march", "april", "may", "june", "july", "august",
	"september", "october", "november", "december", "jan", "feb", "mar", "apr",
	"jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);

function stem(word: string): string {
	return word.toLowerCase().replace(/[^a-z]/g, "").replace(/(ies|es|s)$/, "");
}

function stemsMatch(a: string, b: string): boolean {
	if (!a || !b) return false;
	if (Math.min(a.length, b.length) < 3) return a === b;
	return a.startsWith(b) || b.startsWith(a);
}

function wordsAfter(text: string, from: number, n: number): string[] {
	return text.slice(from).match(/[A-Za-z][A-Za-z'-]*/g)?.slice(0, n) ?? [];
}

function wordsBefore(text: string, to: number, n: number): string[] {
	const found = text.slice(Math.max(0, to - 80), to).match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
	return found.slice(-n);
}

/** Whether a countable noun follows within two words, and whether one exists at all. */
function nounContext(after: string[]): { adjacent: boolean; hasNoun: boolean } {
	const nounStart = after.findIndex((w) => !STOP_AFTER.has(w.toLowerCase()));
	const hasNoun = nounStart !== -1;
	const adjacent =
		nounStart === 0 ||
		(nounStart > 0 && nounStart <= 2 && after.slice(0, nounStart).every((w) => w.length > 2));
	return { adjacent: adjacent && hasNoun, hasNoun };
}

export function extractMentions(text: string): Mention[] {
	const digitRe = new RegExp(
		String.raw`(?:([£$€])\s?)?(${DIGIT_SRC})(?:\s?(k|m|bn|thousand|million|billion|hundred)\b)?(\s?(?:%|percent\b|per\s?cent\b))?(x\b)?`,
		"gi"
	);
	const wordRe = new RegExp(String.raw`\b(?:${WORD_NUMBER_SRC})\b`, "gi");

	const found: Mention[] = [];

	for (const m of text.matchAll(digitRe)) {
		const index = m.index ?? 0;
		if (index > 0 && /[A-Za-z0-9.]/.test(text[index - 1] ?? "") && !m[1]) {
			// Part of an identifier like "v2" or "abc123", not a figure.
			continue;
		}
		const value = parseDigits(m[2]) * (m[3] ? SCALE_WORDS[m[3].toLowerCase()] : 1);
		const end = index + m[0].length;
		const after = wordsAfter(text, end, 3);
		const firstAfter = (after[0] ?? "").toLowerCase();
		const ctx = nounContext(after);

		let kind: ClaimKind = "number";
		if (m[4]) kind = "percentage";
		else if (m[1] || CURRENCY_WORDS.has(firstAfter)) kind = "currency";

		const isYear =
			kind === "number" && !m[3] && /^\d{4}$/.test(m[2]) && value >= 1900 && value <= 2100;
		const monthBefore = MONTHS.has((wordsBefore(text, index, 1)[0] ?? "").toLowerCase());

		let checkable = true;
		if (isYear || monthBefore) checkable = false;
		else if (kind === "number" && value < 10) {
			// Small bare numbers are only claims when attached to something countable.
			checkable = ctx.adjacent;
		}
		if (kind === "number" && ctx.adjacent && !UNIT_NOUNS.has(firstAfter)) {
			kind = "count";
		}
		if (m[5]) {
			kind = "number"; // multiplier such as 10x
			checkable = true;
		}

		found.push({
			raw: m[0].trim(),
			value,
			start: index,
			end,
			kind,
			nouns: [...wordsBefore(text, index, 3), ...after].map(stem).filter(Boolean),
			checkable,
		});
	}

	for (const m of text.matchAll(wordRe)) {
		const value = parseWordNumber(m[0]);
		if (value == null) continue;
		const index = m.index ?? 0;
		const end = index + m[0].length;
		const after = wordsAfter(text, end, 3);
		const firstAfter = (after[0] ?? "").toLowerCase();
		const ctx = nounContext(after);

		let kind: ClaimKind = CURRENCY_WORDS.has(firstAfter) ? "currency" : "count";
		if (UNIT_NOUNS.has(firstAfter)) kind = "number";
		const checkable = value < 10 ? ctx.adjacent : true;

		found.push({
			raw: m[0].trim(),
			value,
			start: index,
			end,
			kind,
			nouns: [...wordsBefore(text, index, 3), ...after].map(stem).filter(Boolean),
			checkable,
		});
	}

	// Drop overlaps (a digit match inside a longer word match, and vice versa).
	found.sort((a, b) => a.start - b.start || b.end - a.end);
	const out: Mention[] = [];
	for (const mention of found) {
		const last = out[out.length - 1];
		if (last && mention.start < last.end) continue;
		out.push(mention);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Strong claims (non numeric)
// ---------------------------------------------------------------------------

/** `needle` is searched for in the record; when empty, the matched phrase itself is used. */
const STRONG_CLAIMS: Array<{ re: RegExp; needle: string }> = [
	{ re: /\bdoubled\b/i, needle: "doubl" },
	{ re: /\btripled\b/i, needle: "tripl" },
	{ re: /\bhalved\b/i, needle: "halved" },
	{ re: /\bsingle[- ]handedly\b/i, needle: "single-hand" },
	{ re: /\bfrom scratch\b/i, needle: "from scratch" },
	{ re: /\b(?:zero|no) downtime\b/i, needle: "downtime" },
	{ re: /\b(?:millions|thousands|hundreds) of (?:users|customers|people|requests)\b/i, needle: "" },
	{ re: /\b(?:entire|whole) (?:company|organisation|organization|business)\b/i, needle: "" },
	{ re: /\baward[- ]winning\b/i, needle: "award" },
	{ re: /\bindustry[- ]leading\b/i, needle: "industry-leading" },
	{ re: /\bthe (?:only|first) (?:person|engineer|designer|developer|team|one)\b/i, needle: "" },
];

// ---------------------------------------------------------------------------
// Support checking
// ---------------------------------------------------------------------------

function splitSentences(text: string): string[] {
	return (text.match(/[^.!?\n]+(?:[.!?]+(?=\s|$)|$)/g) ?? [])
		.map((s) => s.trim())
		.filter(Boolean);
}

function isSupported(mention: Mention, record: Mention[]): boolean {
	const sameValue = record.filter(
		(r) => Math.abs(r.value - mention.value) < 1e-9 * Math.max(1, Math.abs(mention.value))
	);
	if (sameValue.length === 0) return false;
	// A percentage must match a recorded percentage ("30%" is not supported by "30 minutes").
	if (mention.kind === "percentage") return sameValue.some((r) => r.kind === "percentage");
	if (mention.kind === "currency") return sameValue.some((r) => r.kind !== "percentage");

	// Counts and measures: the figure must sit next to the same noun in the record.
	const claimNouns = mention.nouns.filter((n) => n.length >= 3 && !STOP_AFTER.has(n));
	if (claimNouns.length === 0) return true;
	return sameValue.some((r) =>
		r.nouns.some((rn) => claimNouns.some((cn) => stemsMatch(rn, cn)))
	);
}

function truncate(statement: string): string {
	return statement.length > MAX_STATEMENT_CHARS
		? `${statement.slice(0, MAX_STATEMENT_CHARS - 3).trimEnd()}...`
		: statement;
}

/**
 * Check an answer against a fact sheet.
 *
 * Returns null when there is no fact sheet, so callers add nothing to their
 * response. Otherwise returns the unsupported statements (possibly none).
 */
export function checkClaims(
	transcript: string,
	factSheet: string | null | undefined
): ClaimsCheck | null {
	const sheet = factSheet?.trim();
	if (!sheet) return null;

	const record = extractMentions(sheet);
	const sheetSearch = sheet.toLowerCase().replace(/\s+/g, " ");

	const items: ClaimItem[] = [];
	const seen = new Set<string>();

	for (const sentence of splitSentences(transcript)) {
		const flagged: string[] = [];
		const kinds: ClaimKind[] = [];

		for (const mention of extractMentions(sentence)) {
			if (!mention.checkable) continue;
			if (!isSupported(mention, record)) {
				flagged.push(mention.raw);
				kinds.push(mention.kind);
			}
		}

		for (const strong of STRONG_CLAIMS) {
			const hit = sentence.match(strong.re);
			if (!hit) continue;
			const needle = strong.needle || hit[0].toLowerCase();
			if (!sheetSearch.includes(needle)) {
				flagged.push(hit[0]);
				kinds.push("claim");
			}
		}

		if (flagged.length === 0) continue;
		const key = sentence.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		items.push({
			statement: truncate(sentence),
			flagged: [...new Set(flagged)],
			kinds: [...new Set(kinds)],
		});
		if (items.length >= MAX_ITEMS) break;
	}

	return { label: CLAIMS_LABEL, items };
}
