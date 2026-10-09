/**
 * Read-only question-quality audit.
 *
 *   npx tsx scripts/audit-questions.ts [dir-with-csvs] > audit.csv   (default: public/banks)
 *
 * Reads CSV banks from disk only. It never touches the database and never deletes or edits
 * anything; the output is a reviewable list of proposed actions.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { auditQuestions, summariseAudit, type AuditInput } from "../lib/question-quality";

const dir = process.argv[2] ?? "public/banks";
const items: AuditInput[] = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith(".csv")).sort()) {
	const parsed = Papa.parse<Record<string, string>>(readFileSync(join(dir, file), "utf8"), {
		header: true,
		skipEmptyLines: true,
	});
	parsed.data.forEach((row, i) => {
		const text = row.front ?? row.text;
		if (!text) return;
		items.push({
			id: `${file}#${i + 1}`,
			bank: file.replace(/\.csv$/, ""),
			text,
			hint: row.back ?? null,
			tags: row.tags ? row.tags.split(",").map((t) => t.trim()) : [],
		});
	});
}

const rows = auditQuestions(items);
console.error(JSON.stringify(summariseAudit(rows), null, 2));
console.log(
	Papa.unparse(
		rows.map((r) => ({
			id: r.id,
			bank: r.bank,
			classification: r.classification,
			action: r.action,
			issues: r.issues.join("; "),
			duplicate_of: r.duplicateOf.join(" "),
			contexts: r.contexts.join(" "),
			question: r.text,
		})),
	),
);
