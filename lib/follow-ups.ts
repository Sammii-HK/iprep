/**
 * Follow-up questions built only from the key points a learner's answer left out (Teach-back style). Never adds
 * a fact the question's own reference points do not contain. Asking one does not change the grade.
 */

export interface FollowUp {
	question: string;
	target: string;
}

export function gist(point: string, maxLength = 80): string {
	const t = point.trim().replace(/\s+/g, " ");
	if (t.length <= maxLength) return t;
	const cut = t.slice(0, maxLength);
	const space = cut.lastIndexOf(" ");
	return `${space > 0 ? cut.slice(0, space) : cut}…`;
}

export function followUpsFromMissed(missed: readonly string[], persona: "Jess" | "Zac" = "Jess", limit = 2): FollowUp[] {
	const seen = new Set<string>();
	const out: FollowUp[] = [];
	for (const raw of missed) {
		const point = raw.trim();
		if (!point || seen.has(point.toLowerCase())) continue;
		seen.add(point.toLowerCase());
		out.push({
			question: `${persona}: I follow so far, but what about "${gist(point)}"? How does that fit in?`,
			target: point,
		});
		if (out.length >= limit) break;
	}
	return out;
}
