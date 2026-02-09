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
} from "@/lib/errors";
import { requireAuth } from "@/lib/auth";

export async function POST(request: NextRequest) {
	try {
		const user = await requireAuth(request);
		const body = await request.json();
		const { sessionItemId, transcript, sessionId, questionId } = body;

		if (!sessionItemId || !transcript || !sessionId || !questionId) {
			throw new ValidationError("Missing required fields");
		}

		if (transcript.trim().length < 10) {
			throw new ValidationError("Transcript too short for analysis");
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

		if (sessionItem.session.userId && sessionItem.session.userId !== user.id && user.role !== "ADMIN") {
			throw new ValidationError("You do not have access to this session");
		}

		const question = sessionItem.question;
		const trimmedTranscript = transcript.trim();

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
			(question as { type?: string }).type || undefined
		);

		const concisenessScore = calculateConcisenessScore(
			wordCount,
			fillerCount,
			(question as { type?: string }).type || undefined,
			analysis.questionAnswered,
			repeatedWordsAnalysis.hasExcessiveRepetition
		);

		// Update the session item with corrected transcript and new analysis
		await prisma.sessionItem.update({
			where: { id: sessionItemId },
			data: {
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
			} as Parameters<typeof prisma.sessionItem.update>[0]["data"],
		});

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
