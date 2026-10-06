import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { transcribeAudio } from "@/lib/ai";
import { enforceAiLimits } from "@/lib/rate-limit";
import { validateAudioFile } from "@/lib/validation";
import { countWords } from "@/lib/scoring";
import {
	ExternalServiceError,
	ValidationError,
	handleApiError,
} from "@/lib/errors";
import { cleanContextField, processDebrief } from "@/lib/debrief";

const TRANSCRIPTION_TIMEOUT_MS = 60_000;
const MIN_WORDS = 8;

export async function POST(request: NextRequest) {
	try {
		// Authenticate first, then durable per-user limits, before any paid work.
		const user = await requireAuth(request);
		await enforceAiLimits("debrief", user.id);

		const formData = await request.formData();
		const audio = formData.get("audio");
		if (!(audio instanceof Blob) || audio.size === 0) {
			throw new ValidationError("Missing required field: audio");
		}

		const audioValidation = validateAudioFile(audio as File);
		if (!audioValidation.valid) {
			throw new ValidationError(audioValidation.error || "Invalid audio file");
		}

		const context = {
			company: cleanContextField(formData.get("company")),
			role: cleanContextField(formData.get("role")),
			stage: cleanContextField(formData.get("stage")),
		};

		let transcript: string;
		try {
			const result = await Promise.race([
				transcribeAudio(new Blob([await audio.arrayBuffer()], { type: audio.type })),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error("Transcription timeout after 60s")),
						TRANSCRIPTION_TIMEOUT_MS
					)
				),
			]);
			transcript = result.transcript?.trim() ?? "";
		} catch (error) {
			console.error(
				"Debrief transcription failed:",
				error instanceof Error ? error.message : "unknown error"
			);
			throw new ExternalServiceError(
				"OpenAI Whisper",
				"Failed to transcribe the recording. Please try again."
			);
		}

		if (countWords(transcript) < MIN_WORDS) {
			throw new ValidationError(
				"That recording was too short to debrief. Try again with a minute or two on what they asked and where you stumbled."
			);
		}

		const { debrief, bank } = await processDebrief(user.id, transcript, context);

		return NextResponse.json({
			debrief,
			transcript,
			context,
			bank: {
				id: bank.bankId,
				title: bank.bankTitle,
				added: bank.added.length,
				skipped: bank.skipped.length,
			},
		});
	} catch (error) {
		const e = handleApiError(error);
		return NextResponse.json(
			{ error: e.message, code: e.code, ...(e.details ? { details: e.details } : {}) },
			{ status: e.statusCode }
		);
	}
}
