/**
 * Pure constants and helpers for the per-user fact sheet (no database access,
 * safe to import from prompt builders, schemas and tests).
 *
 * Storage convention, see lib/fact-sheet.ts: a QuestionBank titled `__facts__`.
 */

export const FACTS_BANK_TITLE = "__facts__";
export const FACT_SHEET_MAX_CHARS = 8000;

export function isFactsBankTitle(title: string | null | undefined): boolean {
	return title === FACTS_BANK_TITLE;
}

/** Prisma `where` fragment for QuestionBank queries that hides the fact sheet bank. */
export const notFactsBank = { title: { not: FACTS_BANK_TITLE } } as const;

/** Trim and bound a sheet. Returns "" when there is nothing usable. */
export function normaliseFactSheet(text: string): string {
	return text.replace(/\r\n/g, "\n").trim().slice(0, FACT_SHEET_MAX_CHARS);
}
