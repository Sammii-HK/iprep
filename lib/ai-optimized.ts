/**
 * Optimized AI analysis functions with:
 * - Condensed prompts (70% token reduction)
 * - Caching support
 * - Ready for streaming (can be added later)
 */

import OpenAI from "openai";
import { z } from "zod";
import {
	CoachingPreferences,
	DEFAULT_PREFERENCES,
	getCoachingStylePrompt,
	getFocusAreaContext,
} from "./coaching-config";
import { analysisCache } from "./ai-cache";

// Initialize OpenAI client
const getOpenAIClient = () => {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		throw new Error("OPENAI_API_KEY environment variable is required");
	}
	return new OpenAI({ apiKey });
};

const openai = getOpenAIClient();

const EnhancedAnalysisResponseSchema = z.object({
	questionAnswered: z.boolean(),
	answerQuality: z.number().int().min(0).max(5),
	whatWasRight: z.array(z.string()).min(2).max(4),
	betterWording: z.array(z.string()).min(0).max(3), // Concise wording improvements (grammar fixes use "You said" format) - allow 0-3 items
	dontForget: z.array(z.string()).min(0).max(4), // Vital specific points missing from answer (empty if nothing vital missing)
	starScore: z.number().int().min(0).max(5),
	impactScore: z.number().int().min(0).max(5),
	clarityScore: z.number().int().min(0).max(5),
	technicalAccuracy: z.number().int().min(0).max(5),
	terminologyUsage: z.number().int().min(0).max(5),
	tips: z.array(z.string()).length(5),
});

export type EnhancedAnalysisResponse = z.infer<
	typeof EnhancedAnalysisResponseSchema
>;

/**
 * Build optimized system prompt (condensed from ~2000 to ~600 tokens)
 */
function buildOptimizedSystemPrompt(
	coachingPrefs: CoachingPreferences
): string {
	const style = getCoachingStylePrompt(coachingPrefs.style);
	const level = coachingPrefs.experienceLevel;
	const levelExpectation =
		level === "junior"
			? "basics, fundamentals, learning"
			: level === "mid"
			? "solid knowledge, some metrics"
			: level === "senior"
			? "deep expertise, strong metrics"
			: "strategic vision, executive presence";

	return `Expert ${level} iPrep. ${style}

Return JSON only:
{
  "questionAnswered": boolean,
  "answerQuality": 0-5,
  "whatWasRight": ["item1", "item2", "item3"],
  "betterWording": ["suggestion1", "suggestion2"],
  "dontForget": ["point1"] or [],
  "starScore": 0-5,
  "impactScore": 0-5,
  "clarityScore": 0-5,
  "technicalAccuracy": 0-5,
  "terminologyUsage": 0-5,
  "tips": ["tip1", "tip2", "tip3", "tip4", "tip5"]
}

Formatting:
- betterWording (0-3): Grammar/English fixes use "You said: '[exact quote]'. Better: '[fix]'". Other improvements: brief (1 sentence). Can be empty if no improvements needed.
- dontForget (0-4): CRITICAL: If Expected Answer/Key Points are provided, compare the user's answer against those key points. List ONLY the specific key points from the Expected Answer that were MISSING or not adequately covered. These are points they MUST remember. Empty [] if all key points were covered or if no Expected Answer provided. No generic reminders - only specific missing key points.
- whatWasRight (2-4): Specific correct points from their answer.
- tips (5): Actionable, concise tips.

Scoring (0-5):
- answerQuality: 5=complete, 4=good, 3=partial, 2=tangential, 1=barely, 0=none
- technicalAccuracy: 5=deep, 4=good, 3=basic, 2=superficial, 1=errors, 0=wrong
- terminologyUsage: 5=precise, 4=good, 3=mixed, 2=generic, 1=few, 0=none
- clarityScore: 5=excellent, 4=good, 3=adequate, 2=unclear, 1=confusing, 0=incoherent
- starScore/impactScore: Use for behavioral/STAR questions only. Set to 3 for pure technical questions.

Context: ${coachingPrefs.priorities
		.slice(0, 3)
		.join(", ")}, ${getFocusAreaContext(
		coachingPrefs.focusAreas
	)}. Level: ${levelExpectation}.`;
}

/**
 * Build optimized user prompt (condensed from ~1000 to ~300 tokens)
 */
function buildOptimizedUserPrompt(
	transcript: string,
	questionText?: string,
	questionHint?: string | null,
	questionTags: string[] = [],
	metrics?: {
		wordCount: number;
		fillerCount: number;
		fillerRate: number;
		wpm: number;
		longPauses: number;
	}
): string {
	const wordCount =
		metrics?.wordCount ||
		transcript
			.trim()
			.split(/\s+/)
			.filter((w) => w.length > 0).length;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const fillerCount = metrics?.fillerCount || 0;
	const fillerRate = metrics?.fillerRate || 0;
	const wpm = metrics?.wpm || 0;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const longPauses = metrics?.longPauses || 0;

	// OPTIMIZE: Truncate long transcripts for faster processing while keeping quality
	// Keep first 600 words (context) and last 200 words (conclusion) - total ~800 words
	const MAX_TRANSCRIPT_WORDS = 800; // Balanced: faster than 1000, but keeps more context than 650
	let processedTranscript = transcript;
	if (wordCount > MAX_TRANSCRIPT_WORDS) {
		const words = transcript.split(/\s+/);
		const firstPart = words.slice(0, 600).join(" ");
		const lastPart = words.slice(-200).join(" ");
		processedTranscript = `${firstPart}... [${
			wordCount - 800
		} words omitted] ...${lastPart}`;
		if (process.env.NODE_ENV === "development") {
			console.log(
				`Truncated transcript from ${wordCount} to ~800 words for faster processing`
			);
		}
	}

	// Build concise prompt - removed redundant instructions (already in system prompt)
	let prompt = "";

	if (questionText) {
		prompt += `Q: ${questionText}\n`;
	}
	if (questionHint) {
		// Truncate hint if too long (keep first 300 chars for better context)
		const hint =
			questionHint.length > 300
				? questionHint.substring(0, 300) + "..."
				: questionHint;
		prompt += `Expected Answer/Key Points: ${hint}\n`;
		prompt += `CRITICAL: Compare their answer against these key points. For dontForget, identify which specific key points from above were MISSING or not adequately covered in their answer. These are critical points they must remember.\n`;
	}
	if (questionTags.length > 0) {
		prompt += `Tags: ${questionTags.slice(0, 3).join(", ")}\n`; // Reduced to 3 tags
	}

	prompt += `\nAnswer: ${processedTranscript}\n`;
	prompt += `Metrics: ${wordCount}w, ${fillerRate.toFixed(
		1
	)}% fillers, ${wpm}wpm\n`;

	return prompt;
}

/**
 * Optimized transcript analysis with caching and reduced token usage
 */
export async function analyzeTranscriptOptimized(
	transcript: string,
	questionId: string,
	questionTags: string[] = [],
	role?: string,
	priorities?: string[],
	questionText?: string,
	questionHint?: string | null,
	preferences?: Partial<CoachingPreferences>,
	metrics?: {
		wordCount: number;
		fillerCount: number;
		fillerRate: number;
		wpm: number;
		longPauses: number;
	}
): Promise<EnhancedAnalysisResponse> {
	// Validate transcript
	const trimmedTranscript = transcript.trim();
	if (!trimmedTranscript || trimmedTranscript.length === 0) {
		throw new Error("Transcript is empty or invalid");
	}

	if (trimmedTranscript.length < 10) {
		throw new Error(
			`Transcript too short (${trimmedTranscript.length} chars). Minimum 10 characters required.`
		);
	}

	if (process.env.NODE_ENV === "development") {
		console.log("analyzeTranscriptOptimized called", {
			transcriptLength: trimmedTranscript.length,
			questionId,
			questionTags: questionTags.length,
			hasQuestionText: !!questionText,
			hasQuestionHint: !!questionHint,
			hasMetrics: !!metrics,
			hasPreferences: !!preferences,
		});
	}

	// Merge preferences
	const coachingPrefs: CoachingPreferences = {
		...DEFAULT_PREFERENCES,
		...preferences,
		role: role || preferences?.role || DEFAULT_PREFERENCES.role,
		priorities:
			priorities || preferences?.priorities || DEFAULT_PREFERENCES.priorities,
	};

	// Check cache first (use trimmed transcript for cache key)
	const cached = analysisCache.get<EnhancedAnalysisResponse>(
		trimmedTranscript, // Use trimmed transcript for cache
		questionId,
		questionTags,
		coachingPrefs as unknown as Record<string, unknown>
	);

	if (cached) {
		if (process.env.NODE_ENV === "development") {
			console.log("Using cached analysis result");
		}
		return cached;
	}

	// Build optimized prompts (use trimmed transcript)
	const systemPrompt = buildOptimizedSystemPrompt(coachingPrefs);
	const userPrompt = buildOptimizedUserPrompt(
		trimmedTranscript, // Use trimmed transcript
		questionText,
		questionHint,
		questionTags,
		metrics
	);

	if (process.env.NODE_ENV === "development") {
		console.log("Prompts built", {
			systemPromptLength: systemPrompt.length,
			userPromptLength: userPrompt.length,
			transcriptInPrompt: trimmedTranscript.substring(0, 50) + "...",
		});

		console.log("Optimized prompt lengths:", {
			system: systemPrompt.length,
			user: userPrompt.length,
			estimatedTokens: Math.ceil((systemPrompt.length + userPrompt.length) / 4), // Rough estimate: 4 chars per token
		});
	}

	let attempts = 0;
	const maxAttempts = 2; // Reduced from 3 for faster failure recovery

	while (attempts < maxAttempts) {
		try {
			const completion = await openai.chat.completions.create({
				model: "gpt-4o-mini",
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt },
				],
				response_format: { type: "json_object" },
				temperature: 0.25, // Balanced: faster than 0.3 but maintains quality better than 0.2
				max_tokens: 1000, // Balanced: enough for quality feedback, less than 1200 for speed
				top_p: 0.95, // Slightly lower for speed, but maintains quality
			});

			const fullText = completion.choices[0]?.message?.content;
			if (!fullText) {
				throw new Error("No content in response from OpenAI");
			}

			// Log the raw response for debugging (dev only)
			if (process.env.NODE_ENV === "development") {
				console.log("OpenAI raw response:", {
					length: fullText.length,
					preview: fullText.substring(0, 500),
					endsWithBrace: fullText.trim().endsWith("}"),
					startsWithBrace: fullText.trim().startsWith("{"),
				});
			}

			// Parse JSON response
			// When response_format: { type: "json_object" } is used, OpenAI returns pure JSON
			// No need for regex extraction - parse directly
			let parsed;
			try {
				// Trim whitespace and parse directly
				const trimmedResponse = fullText.trim();
				parsed = JSON.parse(trimmedResponse);

				console.log("Parsed JSON keys:", Object.keys(parsed));
				console.log(
					"Parsed JSON preview:",
					JSON.stringify(parsed).substring(0, 500)
				);

				// Check if parsed object is empty or missing required fields
				if (!parsed || Object.keys(parsed).length === 0) {
					console.error("Parsed JSON is empty!");
					throw new Error("OpenAI returned an empty JSON object");
				}
			} catch (parseError) {
				console.error("JSON parse error:", parseError);
				console.error("Response text (full):", fullText);
				console.error("Response length:", fullText.length);

				// Try fallback: extract JSON if wrapped in markdown or other text
				try {
					const jsonMatch = fullText.match(/\{[\s\S]*\}/);
					if (jsonMatch && jsonMatch[0]) {
						console.log("Attempting fallback JSON extraction...");
						parsed = JSON.parse(jsonMatch[0]);
						console.log(
							"Fallback extraction successful, keys:",
							Object.keys(parsed)
						);
					} else {
						throw parseError;
					}
				} catch {
					throw new Error(
						`Failed to parse JSON: ${
							parseError instanceof Error ? parseError.message : "Unknown error"
						}`
					);
				}
			}

			// Validate with schema
			let validated;
			try {
				validated = EnhancedAnalysisResponseSchema.parse(parsed);
			} catch (schemaError) {
				console.error("Schema validation error:", schemaError);
				console.error("Parsed object:", JSON.stringify(parsed, null, 2));
				console.error(
					"Expected schema fields:",
					Object.keys(EnhancedAnalysisResponseSchema.shape)
				);
				throw schemaError;
			}

			// Cache the result (use trimmed transcript for cache key)
			analysisCache.set(
				trimmedTranscript, // Use trimmed transcript for cache
				questionId,
				questionTags,
				validated,
				24 * 60 * 60 * 1000, // 24 hours TTL
				coachingPrefs as unknown as Record<string, unknown>
			);

			console.log("Optimized analysis completed", {
				questionAnswered: validated.questionAnswered,
				answerQuality: validated.answerQuality,
				cached: false,
			});

			return validated;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			const errorName = error instanceof Error ? error.name : "UnknownError";
			const errorStack = error instanceof Error ? error.stack : undefined;

			console.error(`Optimized analysis attempt ${attempts + 1} failed:`, {
				error: errorMessage,
				name: errorName,
				stack: errorStack,
				transcriptLength: transcript.length,
				transcriptPreview: transcript.substring(0, 100),
				questionId,
				questionTags,
			});

			attempts++;

			if (attempts >= maxAttempts) {
				// Return fallback with more detailed error info
				const wordCount =
					metrics?.wordCount ||
					trimmedTranscript.split(/\s+/).filter((w) => w.length > 0).length;
				const isTimeout =
					errorMessage.includes("timeout") || errorName === "TimeoutError";
				const isNetworkError =
					errorMessage.includes("network") ||
					errorMessage.includes("fetch") ||
					errorName === "NetworkError";

				const fallback: EnhancedAnalysisResponse = {
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
					dontForget: [], // Only include if specific vital points are missing
					starScore: 2,
					impactScore: 2,
					clarityScore: 2,
					technicalAccuracy: 2,
					terminologyUsage: 2,
					tips: [
						isTimeout
							? "AI analysis timed out - your response was recorded, but detailed feedback is unavailable. Please try again."
							: isNetworkError
							? "Network error during AI analysis - your response was recorded. Please check your connection and try again."
							: `AI analysis temporarily unavailable (${errorName}). Your response was recorded successfully.`,
						"Your response was recorded successfully",
						"Review your transcript and practice speaking more clearly",
						"Use the STAR method: Situation, Task, Action, Result",
						"Include specific metrics and outcomes when possible",
					],
				};

				console.error("Returning fallback analysis after all retries failed:", {
					errorMessage,
					errorName,
					wordCount,
					transcriptLength: trimmedTranscript.length,
					transcriptPreview: trimmedTranscript.substring(0, 200),
				});

				return fallback;
			}

			// Exponential backoff (reduced delay for faster recovery)
			await new Promise((resolve) => setTimeout(resolve, 500 * attempts)); // Reduced from 1000ms
		}
	}

	throw new Error("Failed to analyze transcript after retries");
}

// Streaming support can be added later using Vercel AI SDK
// For now, we use the optimized non-streaming version which is faster due to caching
