#!/usr/bin/env node
/**
 * Upload a markdown fact sheet to iPrep (PUT /api/user/facts).
 *
 * Usage:
 *   IPREP_BASE_URL=https://your-host IPREP_API_TOKEN=ipm_... \
 *     node scripts/seed-fact-sheet.mjs path/to/fact-sheet.md --target preview
 *   ... --target production --confirm <host>     (production needs the typed host)
 *
 * The token is a machine principal holding the facts:write scope (scripts/principals.ts create --name facts-seed).
 * The target is explicit: --target local|preview|production must match IPREP_BASE_URL.
 *
 * Auth is a bearer machine principal acting as one learner (never admin). The sheet is capped at 8000 characters server side;
 * this script refuses to send anything longer rather than truncating it.
 */

import { readFile } from "node:fs/promises";

const MAX_CHARS = 8000;

async function main() {
	const argv = process.argv.slice(2);
	const flag = (name) => {
		const i = argv.indexOf(name);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const filePath = argv.find((a, i) => !a.startsWith("--") && !["--target", "--confirm"].includes(argv[i - 1]));
	const baseUrl = process.env.IPREP_BASE_URL;
	const key = process.env.IPREP_API_TOKEN;

	const PRODUCTION_HOSTS = ["iprep-five.vercel.app"];
	const target = flag("--target");
	if (!["local", "preview", "production"].includes(target ?? "")) {
		console.error("Refused: pass --target local|preview|production. There is no default.");
		process.exit(3);
	}
	let host = "";
	try {
		host = new URL(baseUrl ?? "").hostname;
	} catch {
		// handled below
	}
	const kind = PRODUCTION_HOSTS.includes(host) ? "production" : ["localhost", "127.0.0.1"].includes(host) ? "local" : "preview";
	if (kind !== target) {
		console.error(`Refused: --target ${target} but IPREP_BASE_URL host "${host}" is a ${kind} target.`);
		process.exit(3);
	}
	if (target === "production" && flag("--confirm") !== host) {
		console.error(`Refused: production needs --confirm ${host}.`);
		process.exit(3);
	}
	console.log(`Target: ${target} (${host})`);

	if (!filePath) {
		console.error("Usage: node scripts/seed-fact-sheet.mjs <fact-sheet.md> --target <local|preview|production>");
		process.exit(1);
	}
	if (!baseUrl || !key) {
		console.error("Set IPREP_BASE_URL and IPREP_API_TOKEN (a facts:write machine principal token) in the environment.");
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
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
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
