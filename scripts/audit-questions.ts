/**
 * Read-only question-quality audit. Never deletes, edits or archives anything.
 *
 *   CSV banks on disk (default public/banks):
 *     npx tsx scripts/audit-questions.ts [dir] > audit.csv
 *
 *   Your database (read-only; the transaction is SET TRANSACTION READ ONLY, so the
 *   database itself refuses any write). Use a direct URL, ideally a read-only role:
 *     AUDIT_DATABASE_URL=postgresql://... npx tsx scripts/audit-questions.ts --db [--user <userId>] > audit.csv
 *
 * Output: one CSV row per question (stdout) and a summary (stderr). The facts bank is never read.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { auditQuestions, summariseAudit, type AuditInput } from "../lib/question-quality";

const FACTS_BANK_TITLE = "__facts__";

async function fromDatabase(userId?: string): Promise<AuditInput[]> {
	const url = process.env.AUDIT_DATABASE_URL;
	if (!url) throw new Error("Set AUDIT_DATABASE_URL to audit a database (it is deliberately separate from DATABASE_URL).");
	const { PrismaClient } = await import("@prisma/client");
	const prisma = new PrismaClient({ datasources: { db: { url } } });
	try {
		return await prisma.$transaction(async (tx) => {
			await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
			const rows = await tx.question.findMany({
				where: {
					archivedAt: null,
					bank: { title: { not: FACTS_BANK_TITLE }, ...(userId ? { userId } : {}) },
				},
				select: { id: true, text: true, hint: true, tags: true, bank: { select: { title: true } } },
				orderBy: [{ bankId: "asc" }, { id: "asc" }],
			});
			return rows.map((r) => ({ id: r.id, bank: r.bank.title, text: r.text, hint: r.hint, tags: r.tags }));
		});
	} finally {
		await prisma.$disconnect();
	}
}

function fromCsvDir(dir: string): AuditInput[] {
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
	return items;
}

async function main() {
	const args = process.argv.slice(2);
	const userIdx = args.indexOf("--user");
	const items = args.includes("--db")
		? await fromDatabase(userIdx >= 0 ? args[userIdx + 1] : undefined)
		: fromCsvDir(args.find((a) => !a.startsWith("--")) ?? "public/banks");

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
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e);
	process.exit(1);
});
