/**
 * Read-only export of your server-side banks into the iOS app's "full import" JSON, so the data
 * can live in the app (and your iCloud) instead of the database.
 *
 *   AUDIT_DATABASE_URL=postgresql://... npx tsx scripts/export-legacy-banks.ts [--user <userId>] > iprep-banks.json
 *
 * Then, in the app, import the file with Banks -> Import (full import). The transaction is
 * SET TRANSACTION READ ONLY, so the database itself refuses any write. The private facts bank is
 * never read. Reference answers ("hint") are not part of that import format and are not exported.
 */

const FACTS_BANK_TITLE = "__facts__";

const difficultyName = (n: number) => (n <= 2 ? "easy" : n >= 4 ? "hard" : "medium");
const FOLDER_COLORS = ["#6C63FF", "#E8A33D", "#3DA9E8", "#5CB85C", "#D9534F", "#9B59B6"];

async function main() {
	const url = process.env.AUDIT_DATABASE_URL;
	if (!url) throw new Error("Set AUDIT_DATABASE_URL (deliberately separate from DATABASE_URL).");
	const args = process.argv.slice(2);
	const userId = args.includes("--user") ? args[args.indexOf("--user") + 1] : undefined;

	const { PrismaClient } = await import("@prisma/client");
	const prisma = new PrismaClient({ datasources: { db: { url } } });
	try {
		const out = await prisma.$transaction(async (tx) => {
			await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
			const banks = await tx.questionBank.findMany({
				where: { title: { not: FACTS_BANK_TITLE }, ...(userId ? { userId } : {}) },
				orderBy: [{ order: "asc" }, { title: "asc" }],
				select: {
					id: true,
					title: true,
					questions: {
						where: { archivedAt: null },
						orderBy: { id: "asc" },
						select: { text: true, tags: true, difficulty: true },
					},
					folderItems: { select: { folder: { select: { title: true } } }, take: 1 },
				},
			});
			const folders = await tx.bankFolder.findMany({
				where: userId ? { userId } : {},
				orderBy: { order: "asc" },
				select: { title: true, color: true, order: true },
			});
			return { banks, folders };
		});

		const json = {
			folders: out.folders.map((f, i) => ({
				name: f.title,
				color: f.color ?? FOLDER_COLORS[i % FOLDER_COLORS.length],
				order: f.order,
			})),
			banks: out.banks
				.filter((b) => b.questions.length > 0)
				.map((b) => ({
					name: b.title,
					folder: b.folderItems[0]?.folder.title,
					questions: b.questions.map((q) => ({
						text: q.text,
						category: q.tags[0] ?? "Custom",
						difficulty: difficultyName(q.difficulty),
					})),
				})),
		};
		console.error(
			`Exported ${json.banks.length} banks, ${json.banks.reduce((n, b) => n + b.questions.length, 0)} questions, ${json.folders.length} folders.`,
		);
		console.log(JSON.stringify(json, null, 2));
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e);
	process.exit(1);
});
