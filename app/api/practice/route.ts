import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { uploadAudio, getAudioUrl } from "@/lib/r2";
import { transcribeAudio } from "@/lib/ai";
import {
	analyzeTranscriptOptimized,
	type EnhancedAnalysisResponse,
} from "@/lib/ai-optimized";
import {
	countWords,
	countFillers,
	calculateWPM,
	calculateFillerRate,
	detectLongPauses,
	detectLongPausesFromTranscript,
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
	RateLimitError,
	ValidationError,
	NotFoundError,
	ExternalServiceError,
} from "@/lib/errors";
import { validateAudioFile, validateId } from "@/lib/validation";
import { CoachingPreferences } from "@/lib/coaching-config";
import { requireAuth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
	try {
		// Rate limiting
		const ip =
			request.headers.get("x-forwarded-for") ||
			request.headers.get("x-real-ip") ||
			"unknown";
		if (!(await checkRateLimit(ip))) {
			throw new RateLimitError("Rate limit exceeded. Please try again later.");
		}

		const formData = await request.formData();
		const audioFile = formData.get("audio") as File | null;
		const sessionId = formData.get("sessionId") as string | null;
		const questionId = formData.get("questionId") as string | null;

		// Get coaching preferences from request (optional)
		const preferencesJson = formData.get("preferences") as string | null;
		let preferences: Partial<CoachingPreferences> | undefined;
		if (preferencesJson) {
			try {
				// Limit JSON size to prevent DoS
				if (preferencesJson.length > 10000) {
					console.warn("Preferences JSON too large, ignoring");
				} else {
					preferences = JSON.parse(preferencesJson);
				}
			} catch (error) {
				// Ignore invalid JSON - log in development
				if (process.env.NODE_ENV !== "production") {
					console.warn("Invalid preferences JSON:", error);
				}
			}
		}

		// Validate required fields
		if (!audioFile || !sessionId || !questionId) {
			throw new ValidationError(
				"Missing required fields: audio, sessionId, questionId"
			);
		}

		// Validate IDs
		if (!validateId(sessionId) || !validateId(questionId)) {
			throw new ValidationError("Invalid sessionId or questionId format");
		}

		// Validate audio file
		const audioValidation = validateAudioFile(audioFile);
		if (!audioValidation.valid) {
			throw new ValidationError(audioValidation.error || "Invalid audio file");
		}

		// Require authentication
		const user = await requireAuth(request);

		// Check if session and question exist (with question text for context)
		const [session, question] = await Promise.all([
			prisma.session.findUnique({
				where: { id: sessionId },
				include: { bank: true },
			}),
			prisma.question.findUnique({
				where: { id: questionId },
				include: { bank: true },
			}),
		]);

		if (!session) {
			throw new NotFoundError("Session", sessionId);
		}
		if (!question) {
			throw new NotFoundError("Question", questionId);
		}

		// Verify user owns the session (unless admin)
		if (session.userId && session.userId !== user.id && user.role !== "ADMIN") {
			throw new ValidationError("You do not have access to this session");
		}

		// Validate that the question belongs to the session's bank
		if (session.bankId && question.bankId !== session.bankId) {
			throw new ValidationError(
				"Question does not belong to this session's question bank"
			);
		}

		// Convert File to Blob
		const audioBlob = new Blob([await audioFile.arrayBuffer()], {
			type: audioFile.type,
		});

		// Note: Audio duration detection removed - Audio API is browser-only
		// We'll use word count estimation instead (more reliable for server-side)
		const actualDuration: number | null = null;

		// Optimize: Start transcription first (critical), then start upload in parallel
		// We'll wait for upload only when we need to save
		let transcript: string;
		let wordTimestamps:
			| Array<{ word: string; start: number; end: number }>
			| undefined;
		let audioUrl: string | null = null;

		// Start transcription (critical path - must complete)
		try {
			if (process.env.NODE_ENV === "development") {
				console.log("Starting audio transcription...", {
					audioSize: audioBlob.size,
					audioType: audioFile.type,
				});
			}

			// Include word timestamps for accurate pause detection, WPM, and delivery metrics
			const transcriptionResult = await Promise.race([
				transcribeAudio(
					audioBlob,
					{
						questionText: question.text,
						questionTags: question.tags,
						questionHint: question.hint,
					},
					{
						includeWordTimestamps: true,
					}
				),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error("Transcription timeout after 60s")),
						60000
					)
				),
			]);
			transcript = transcriptionResult.transcript;
			wordTimestamps = transcriptionResult.words;

			console.log("Transcription completed", {
				transcriptLength: transcript.length,
				wordCount: countWords(transcript),
				hasWordTimestamps: !!wordTimestamps && wordTimestamps.length > 0,
			});
		} catch (error) {
			console.error("Transcription failed:", error);
			console.error("Error details:", {
				message: error instanceof Error ? error.message : "Unknown error",
				audioSize: audioBlob.size,
			});
			throw new ExternalServiceError(
				"OpenAI Whisper",
				`Failed to transcribe audio: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}

		// Start audio upload in background (non-blocking)
		// We'll await it only when we need to save the audioUrl
		const uploadPromise = Promise.race([
			uploadAudio(audioBlob, audioFile.type),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("Upload timeout")), 30000)
			),
		])
			.then((key) => {
				audioUrl = getAudioUrl(key);
			})
			.catch((error) => {
				// Log but don't fail - transcription and analysis are more important
				console.error("Failed to upload audio to R2 (non-critical):", error);
				audioUrl = null;
			});

		// Validate transcript is not empty
		if (!transcript || transcript.trim().length === 0) {
			throw new ValidationError(
				`Transcript is empty. Audio size: ${audioBlob.size} bytes, type: ${audioFile.type}. Please ensure audio contains speech.`
			);
		}

		// OPTIMIZE: Calculate metrics quickly (synchronous, fast) then start AI analysis immediately
		// Metrics are needed for both delivery scores and AI analysis
		const questionTags = question.tags || [];

		// Calculate metrics (fast synchronous operations - ~10-50ms)
		const wordCount = countWords(transcript);
		const fillerCount = countFillers(transcript);
		const fillerRate = calculateFillerRate(fillerCount, wordCount);

		// Use actual duration if available, otherwise estimate from timestamps or word count
		const duration =
			actualDuration && actualDuration > 0
				? actualDuration
				: wordTimestamps && wordTimestamps.length > 0
				? wordTimestamps[wordTimestamps.length - 1].end
				: Math.max(5, wordCount / 3); // More realistic estimate: 3 words per second, minimum 5 seconds

		// Detect long pauses - use timestamps if available, otherwise estimate from transcript
		const longPauses =
			wordTimestamps && wordTimestamps.length > 0
				? detectLongPauses(wordTimestamps)
				: detectLongPausesFromTranscript(transcript, duration);

		const wpm = calculateWPM(wordCount, duration);

		// Analyze confidence and intonation using enhanced versions with pause/timestamp analysis
		const confidenceScore = analyzeConfidenceEnhanced(
			transcript,
			fillerCount,
			wordCount,
			wordTimestamps
		);

		// Always analyze each attempt fresh - users re-practice to improve
		let analysis: EnhancedAnalysisResponse | undefined;
		{
			// Start AI analysis (this is the slowest operation)
			// We already have all the metrics it needs

			// Validate transcript before analysis
			const trimmedTranscript = transcript.trim();
			if (!trimmedTranscript || trimmedTranscript.length === 0) {
				throw new ValidationError(
					"Transcript is empty after trimming. Cannot analyze."
				);
			}

			// Only proceed with AI analysis if we have sufficient content
			// Require at least 5 words OR at least 5 seconds of audio (more lenient for short answers)
			const hasMinimumContent = wordCount >= 5;

			if (!hasMinimumContent) {
				// Return a helpful message instead of default fallback
				analysis = {
					questionAnswered: false,
					answerQuality: 1,
					whatWasRight: ["Your response was recorded"],
					betterWording: [
						`Try speaking for at least ${
							actualDuration ? Math.ceil(5 - actualDuration) : 5
						} more seconds or provide more detail (aim for 10+ words for better feedback)`,
						"Structure your answer with clear examples",
					],
					dontForget: [],
					starScore: 1,
					impactScore: 1,
					clarityScore: 1,
					technicalAccuracy: 1,
					terminologyUsage: 1,
					tips: [
						"Your response was too brief. Try speaking for 10-30 seconds.",
						`You provided ${wordCount} words - aim for 10+ words for better feedback`,
						"Include specific examples and structure your answer clearly",
					],
				};
			} else {
				if (process.env.NODE_ENV === "development") {
					console.log("Starting AI analysis...", {
						transcriptLength: transcript.length,
						trimmedLength: trimmedTranscript.length,
						wordCount,
						duration: actualDuration || "estimated",
						questionTags,
						hasQuestionText: !!question.text,
						hasQuestionHint: !!question.hint,
					});
				}

				try {
					// Pass the trimmed transcript to ensure it's clean
					analysis = await Promise.race([
						analyzeTranscriptOptimized(
							trimmedTranscript, // Use trimmed transcript
							question.id, // questionId for caching
							questionTags,
							undefined, // role - will use from preferences
							undefined, // priorities - will use from preferences
							question.text,
							question.hint,
							preferences,
							{
								wordCount,
								fillerCount,
								fillerRate,
								wpm,
								longPauses,
							},
							(question as { type?: string }).type || undefined
						),
						new Promise<never>(
							(_, reject) =>
								setTimeout(
									() => reject(new Error("Analysis timeout after 45s")),
									45000
								) // Increased timeout for iPad/network issues
						),
					]);

					if (process.env.NODE_ENV === "development") {
						console.log("AI analysis completed successfully", {
							questionAnswered: analysis.questionAnswered,
							answerQuality: analysis.answerQuality,
							tipsCount: analysis.tips.length,
						});
					}
				} catch (error) {
					console.error("Error in AI analysis:", error);
					console.error("Error details:", {
						message: error instanceof Error ? error.message : "Unknown error",
						stack: error instanceof Error ? error.stack : undefined,
						transcriptLength: transcript.length,
						transcriptPreview: transcript.substring(0, 200),
						audioType: audioFile.type,
						audioSize: audioBlob.size,
						questionId: question.id,
						questionTags,
						hasPreferences: !!preferences,
					});

					// Log the full error for debugging
					if (error instanceof Error) {
						console.error("Full error object:", {
							name: error.name,
							message: error.message,
							stack: error.stack,
						});
					}

					// Don't throw - return fallback analysis instead
					const wordCount = countWords(transcript);
					analysis = {
						questionAnswered: wordCount > 20,
						answerQuality: 2,
						whatWasRight: [
							"Your response was recorded successfully",
							"You provided some content",
						],
						betterWording: [
							"Try speaking for 2-3 minutes with clear structure",
							"Use the STAR method: Situation, Task, Action, Result",
							"Include specific metrics and examples",
						],
						dontForget: [],
						starScore: 2,
						impactScore: 2,
						clarityScore: 2,
						technicalAccuracy: 2,
						terminologyUsage: 2,
						tips: [
							`AI analysis error: ${
								error instanceof Error ? error.message : "Unknown error"
							}`,
							"Your response was recorded successfully",
							"Review your transcript and practice speaking more clearly",
							"Use the STAR method: Situation, Task, Action, Result",
							"Include specific metrics and outcomes when possible",
						],
					};
				}
			}
		}

		// Ensure analysis is defined (should always be set by this point)
		if (!analysis) {
			throw new ValidationError("Analysis failed - no result available");
		}

		// Calculate intonation score using enhanced version with word duration analysis
		const intonationScore = analyzeIntonationEnhanced(
			transcript,
			wordCount,
			wordTimestamps
		);

		// Analyze voice quality for pacing, emphasis, and engagement
		const voiceQuality = analyzeVoiceQuality(
			transcript,
			wordTimestamps,
			wordCount
		);

		// Analyze repeated words to identify overused vocabulary
		const repeatedWordsAnalysis = analyzeRepeatedWords(transcript, wordCount);

		// Calculate conciseness score
		const concisenessScore = calculateConcisenessScore(
			wordCount,
			fillerCount,
			(question as { type?: string }).type || undefined,
			analysis.questionAnswered,
			repeatedWordsAnalysis.hasExcessiveRepetition
		);

		// Save to database (await upload to complete first for audioUrl)
		// We need the ID to return in the response
		let sessionItemId: string;
		try {
			// Wait for upload to complete (with timeout)
			// Don't fail if upload times out - we can save without audioUrl
			try {
				await Promise.race([
					uploadPromise,
					new Promise<void>((resolve) => setTimeout(() => resolve(), 10000)), // 10s timeout for upload
				]);
			} catch (uploadError) {
				console.warn(
					"Audio upload timeout or failed (non-critical):",
					uploadError
				);
				// Continue without audioUrl - transcription and analysis are more important
			}

			// Sanitize numeric values — NaN/Infinity crashes Neon's binary protocol
			const safeFloat = (v: unknown): number | null =>
				typeof v === "number" && Number.isFinite(v) ? v : null;
			const safeInt = (v: unknown): number | null =>
				typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;

			const sessionItem = await prisma.sessionItem.create({
				data: {
					sessionId,
					questionId,
					audioUrl: audioUrl || null,
					transcript,
					words: safeInt(wordCount),
					wpm: safeInt(wpm),
					fillerCount: safeInt(fillerCount),
					fillerRate: safeFloat(fillerRate),
					longPauses: safeInt(longPauses),
					confidenceScore: safeFloat(confidenceScore),
					intonationScore: safeFloat(intonationScore),
					starScore: safeFloat(analysis.starScore),
					impactScore: safeFloat(analysis.impactScore),
					clarityScore: safeFloat(analysis.clarityScore),
					technicalAccuracy: safeFloat(analysis.technicalAccuracy),
					terminologyUsage: safeFloat(analysis.terminologyUsage),
					questionAnswered: analysis.questionAnswered ?? null,
					answerQuality: safeFloat(analysis.answerQuality),
					whatWasRight: analysis.whatWasRight || [],
					whatWasWrong: [],
					betterWording: analysis.betterWording || [],
					dontForget: analysis.dontForget || [],
					aiFeedback: analysis.tips?.join(" | ") || "",
				},
			});
			sessionItemId = sessionItem.id;
		} catch (error) {
			throw new ExternalServiceError(
				"Database",
				`Failed to save session item: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}

		// Return response with all data including ID
		return NextResponse.json({
			id: sessionItemId,
			transcript,
			metrics: {
				words: wordCount,
				wpm,
				fillerCount,
				fillerRate,
				longPauses,
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
			whatWasWrong: [], // Not returned by AI analysis anymore, but client expects it
			betterWording: analysis.betterWording,
			dontForget: analysis.dontForget || [],
			repeatedWords: repeatedWordsAnalysis.repeatedWords,
			hasExcessiveRepetition: repeatedWordsAnalysis.hasExcessiveRepetition,
			audioUrl: audioUrl, // May be null if upload still in progress
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
