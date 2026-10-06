import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError, ValidationError } from "@/lib/errors";
import {
	FACT_SHEET_MAX_CHARS,
	getFactSheet,
	setFactSheet,
} from "@/lib/fact-sheet";
import { FactSheetBodySchema } from "@/lib/fact-sheet-schema";

// Hard ceiling on the raw request, well above the character cap, to stop
// oversized bodies before they are parsed.
const MAX_BODY_BYTES = 64 * 1024;

function errorResponse(error: unknown) {
	const e = handleApiError(error);
	return NextResponse.json(
		{ error: e.message, code: e.code },
		{ status: e.statusCode }
	);
}

export async function GET(request: NextRequest) {
	try {
		const user = await requireAuth(request);
		const text = await getFactSheet(user.id);
		return NextResponse.json({ text, maxChars: FACT_SHEET_MAX_CHARS });
	} catch (error) {
		return errorResponse(error);
	}
}

export async function PUT(request: NextRequest) {
	try {
		const user = await requireAuth(request);

		const declared = Number(request.headers.get("content-length") ?? "0");
		if (declared > MAX_BODY_BYTES) {
			throw new ValidationError("Request body is too large");
		}

		let body: unknown;
		try {
			body = await request.json();
		} catch {
			throw new ValidationError("Request body must be valid JSON");
		}

		const parsed = FactSheetBodySchema.safeParse(body);
		if (!parsed.success) {
			throw new ValidationError(
				parsed.error.issues[0]?.message ?? "Invalid fact sheet"
			);
		}

		const text = await setFactSheet(user.id, parsed.data.text);
		return NextResponse.json({ text, maxChars: FACT_SHEET_MAX_CHARS });
	} catch (error) {
		return errorResponse(error);
	}
}
