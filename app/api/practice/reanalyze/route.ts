import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
	analyzeTranscriptOptimized,
} from "@/lib/ai-optimized";
import {
	countWords,
	countFillers,
	calculateWPM,
	calculateFillerRate,
	calculateConcisenessScore,
} from "@/lib/scoring";
import {
	analyzeRepeatedWords,
} from "@/lib/audio-analysis";
import {
	analyzeConfidenceEnhanced,
	analyzeIntonationEnhanced,
	analyzeVoiceQuality,
} from "@/lib/enhanced-audio-analysis";
import {
	handleApiError,
	ValidationError,
	NotFoundError,
	ExternalServiceError,
} from "@/lib/errors";
import { requireAuth } from "@/lib/auth";
import { ownsRecord } from "@/lib/access";
import { enforceAiLimits } from "@/lib/rate-limit";
import { getFactSheet } from "@/lib/fact-sheet";
import { checkClaims } from "@/lib/claims-check";
import { applyReanalysis } from "@/lib/attempt-compat";

export async function POST(request: NextRequest) {
	try {
		const user = await requireAuth(request);
		// Re-analysis is model-backed, so it has the same durable per-user limits as practice.
		await enforceAiLimits("reanalyze", user.id);
		const body = await request.json();
		const { sessionItemId, transcript, sessionId, questionId } = body;

		if (!sessionItemId || !transcript || !sessionId || !questionId) {
			throw new ValidationError("Missing required fields");
		}

		if (typeof transcript !== "string" || typeof sessionItemId !== "string") {
			throw new ValidationError("Invalid request");
		}

		if (transcript.trim().length < 10) {
			throw new ValidationError("Transcript too short for analysis");
		}
		if (transcript.length > 20000) {
			throw new ValidationError("Transcript too long for analysis");
		}

		// Verify session item exists and user owns it
		const sessionItem = await prisma.sessionItem.findUnique({
			where: { id: sessionItemId },
			include: {
				session: true,
				question: { include: { bank: true } },
			},
		});

		if (!sessionItem) {
			throw new NotFoundError("SessionItem", sessionItemId);
		}

		// Owner only.
		if (!ownsRecord(sessionItem.session, user)) {
			throw new NotFoundError("SessionItem", sessionItemId);
		}

		const question = sessionItem.question;
		const trimmedTranscript = transcript.trim();
		const factSheet = await getFactSheet(user.id).catch(() => null);

		// Calculate metrics from corrected transcript
		const wordCount = countWords(trimmedTranscript);
		const fillerCount = countFillers(trimmedTranscript);
		const fillerRate = calculateFillerRate(fillerCount, wordCount);
		const duration = Math.max(5, wordCount / 3);
		const wpm = calculateWPM(wordCount, duration);

		// Analyze with corrected transcript
		const confidenceScore = analyzeConfidenceEnhanced(trimmedTranscript, fillerCount, wordCount, undefined);
		const intonationScore = analyzeIntonationEnhanced(trimmedTranscript, wordCount, undefined);
		const voiceQuality = analyzeVoiceQuality(trimmedTranscript, undefined, wordCount);
		const repeatedWordsAnalysis = analyzeRepeatedWords(trimmedTranscript, wordCount);

		// Get coaching preferences from localStorage won't work server-side, use defaults
		const analysis = await analyzeTranscriptOptimized(
			trimmedTranscript,
			questionId,
			question.tags || [],
			undefined,
			undefined,
			question.text,
			question.hint,
			undefined,
			{ wordCount, fillerCount, fillerRate, wpm, longPauses: 0 },
			(question as { type?: string }).type || undefined,
			factSheet
		);

		const claimsCheck = checkClaims(trimmedTranscript, factSheet);

		const concisenessScore = calculateConcisenessScore(
			wordCount,
			fillerCount,
			(question as { type?: string }).type || undefined,
			analysis.questionAnswered,
			repeatedWordsAnalysis.hasExcessiveRepetition
		);

		// One transaction: append the re-evaluation to the ledger and, only if the evaluator really completed, update
		// the legacy projection. The recorded evidence and earlier evaluations are never edited.
		await applyReanalysis(prisma, {
			attemptId: sessionItem.attemptId,
			sessionItemId,
			legacyUpdate: {
				transcript: trimmedTranscript,
				words: wordCount,
				wpm,
				fillerCount,
				fillerRate,
				confidenceScore,
				intonationScore,
				starScore: analysis.starScore,
				impactScore: analysis.impactScore,
				clarityScore: analysis.clarityScore,
				technicalAccuracy: analysis.technicalAccuracy,
				terminologyUsage: analysis.terminologyUsage,
				questionAnswered: analysis.questionAnswered,
				answerQuality: analysis.answerQuality,
				whatWasRight: analysis.whatWasRight,
				betterWording: analysis.betterWording,
				dontForget: analysis.dontForget || [],
				aiFeedback: analysis.tips.join(" | "),
			},
			recordedTranscript: sessionItem.transcript,
			correctedTranscript: trimmedTranscript,
			provenance: analysis.fallbackReason
				? { status: "FAILED", reason: analysis.fallbackReason }
				: { status: "COMPLETED" },
			questionAnswered: analysis.questionAnswered ?? null,
			scores: {
				answerQuality: analysis.answerQuality,
				starScore: analysis.starScore,
				impactScore: analysis.impactScore,
				clarityScore: analysis.clarityScore,
				technicalAccuracy: analysis.technicalAccuracy,
				terminologyUsage: analysis.terminologyUsage,
			},
			feedback: {
				whatWasRight: analysis.whatWasRight,
				betterWording: analysis.betterWording,
				dontForget: analysis.dontForget || [],
				text: analysis.tips.join(" | "),
			},
			confidenceScore,
			intonationScore,
		});

		// The evaluator failed: the failure is on record, the learner's previous evaluation is untouched, and no
		// canned numbers are shown or stored as if they were knowledge scores.
		if (analysis.fallbackReason) {
			throw new ExternalServiceError(
				"analysis",
				"We could not re-analyse your answer just now. Your previous analysis is unchanged; please try again."
			);
		}

		return NextResponse.json({
			id: sessionItemId,
			transcript: trimmedTranscript,
			metrics: {
				words: wordCount,
				wpm,
				fillerCount,
				fillerRate,
				longPauses: 0,
			},
			scores: {
				confidence: confidenceScore,
				intonation: intonationScore,
				star: analysis.starScore,
				impact: analysis.impactScore,
				clarity: analysis.clarityScore,
				technicalAccuracy: analysis.technicalAccuracy,
				terminologyUsage: analysis.terminologyUsage,
				conciseness: concisenessScore,
				pacing: voiceQuality.pacingScore,
				emphasis: voiceQuality.emphasisScore,
				engagement: voiceQuality.engagementScore,
			},
			tips: analysis.tips,
			questionAnswered: analysis.questionAnswered,
			answerQuality: analysis.answerQuality,
			whatWasRight: analysis.whatWasRight,
			whatWasWrong: [],
			betterWording: analysis.betterWording,
			dontForget: analysis.dontForget || [],
			repeatedWords: repeatedWordsAnalysis.repeatedWords,
			hasExcessiveRepetition: repeatedWordsAnalysis.hasExcessiveRepetition,
			...(claimsCheck ? { claimsCheck } : {}),
		});
	} catch (error) {
		const errorResponse = handleApiError(error);
		return NextResponse.json(
			{
				error: errorResponse.message,
				code: errorResponse.code,
				...(errorResponse.details ? { details: errorResponse.details } : {}),
			},
			{ status: errorResponse.statusCode }
		);
	}
}
