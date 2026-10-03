#!/usr/bin/env node
/**
 * Upload a markdown fact sheet to iPrep (PUT /api/user/facts).
 *
 * Usage:
 *   IPREP_BASE_URL=https://your-host IPREP_INTERNAL_KEY=... \
 *     node scripts/seed-fact-sheet.mjs path/to/fact-sheet.md
 *
 * Auth is the x-internal-key header, which the API resolves to the admin
 * user (ADMIN_EMAIL). The sheet is capped at 8000 characters server side;
 * this script refuses to send anything longer rather than truncating it.
 */

import { readFile } from "node:fs/promises";

const MAX_CHARS = 8000;

async function main() {
	const [, , filePath] = process.argv;
	const baseUrl = process.env.IPREP_BASE_URL;
	const key = process.env.IPREP_INTERNAL_KEY;

	if (!filePath) {
		console.error("Usage: node scripts/seed-fact-sheet.mjs <fact-sheet.md>");
		process.exit(1);
	}
	if (!baseUrl || !key) {
		console.error("Set IPREP_BASE_URL and IPREP_INTERNAL_KEY in the environment.");
		process.exit(1);
	}

	const text = (await readFile(filePath, "utf8")).replace(/\r\n/g, "\n").trim();
	if (text.length === 0) {
		console.error("The file is empty. Nothing to upload.");
		process.exit(1);
	}
	if (text.length > MAX_CHARS) {
		console.error(
			`The sheet is ${text.length} characters; the limit is ${MAX_CHARS}. Shorten it and try again.`
		);
		process.exit(1);
	}

	const url = new URL("/api/user/facts", baseUrl);
	const response = await fetch(url, {
		method: "PUT",
		headers: { "Content-Type": "application/json", "x-internal-key": key },
		body: JSON.stringify({ text }),
	});

	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		console.error(`Upload failed (${response.status}): ${body.error ?? "unknown error"}`);
		process.exit(1);
	}

	console.log(`Fact sheet saved (${body.text?.length ?? 0} characters).`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
