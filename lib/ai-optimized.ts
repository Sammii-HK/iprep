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

/**
 * Sanitize user-provided text before including in AI prompts.
 * Strips potential prompt injection patterns from question text and hints.
 */
function sanitizeForPrompt(text: string): string {
	return text
		// Remove common prompt injection patterns
		.replace(/\b(ignore|disregard|forget)\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?|context)/gi, '[removed]')
		.replace(/\b(you\s+are\s+now|act\s+as|pretend\s+to\s+be|new\s+instructions?|system\s*:)/gi, '[removed]')
		.replace(/\b(do\s+not\s+follow|override|bypass)\s+(the\s+)?(system|instructions?|rules?|constraints?)/gi, '[removed]')
		// Remove attempts to inject JSON structure
		.replace(/```(?:json|system|assistant)[\s\S]*?```/gi, '[removed]')
		// Remove role-play injection attempts
		.replace(/\[\s*(?:system|assistant|user)\s*\]/gi, '[removed]')
		// Trim excessive whitespace
		.replace(/\s{3,}/g, ' ')
		.trim();
}

// Initialize OpenAI client lazily to avoid build-time errors
let openaiClient: OpenAI | null = null;

const getOpenAIClient = () => {
	if (openaiClient) return openaiClient;
	
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		throw new Error("OPENAI_API_KEY environment variable is required");
	}
	openaiClient = new OpenAI({ apiKey });
	return openaiClient;
};

// Lazy getter - only initializes when actually used
const openai = new Proxy({} as OpenAI, {
	get(_, prop) {
		return getOpenAIClient()[prop as keyof OpenAI];
	},
});

// Helper to round to nearest 0.5
function roundToHalf(n: number): number {
	return Math.round(n * 2) / 2;
}

const ScoreSchema = z.number().min(0).max(5).transform(roundToHalf);

const EnhancedAnalysisResponseSchema = z.object({
	questionAnswered: z.boolean(),
	answerQuality: ScoreSchema,
	whatWasRight: z.array(z.string()).min(1).max(6),
	betterWording: z.array(z.string()).max(5), // Concise wording improvements (grammar fixes use "You said" format)
	dontForget: z.array(z.string()).max(8), // OPTIMIZED: If hint provided, return exact phrases from hint that were missing. Otherwise, specific missing points.
	dontForgetIndices: z.array(z.number()).max(8).optional(), // OPTIMIZED: Indices of missing key points in hint (0-based, if hint was split by bullets/numbers)
	starScore: ScoreSchema,
	impactScore: ScoreSchema,
	clarityScore: ScoreSchema,
	technicalAccuracy: ScoreSchema,
	terminologyUsage: ScoreSchema,
	tips: z.array(z.string()).min(1).max(7),
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
  "answerQuality": 0-5 (use 0.5 steps),
  "whatWasRight": ["item1", "item2", "item3"],
  "betterWording": ["suggestion1", "suggestion2"],
  "dontForget": ["point1"] or [],
  "dontForgetIndices": [0, 2] or [] (optional, only if hint is numbered),
  "starScore": 0-5 (use 0.5 steps, e.g. 3.5),
  "impactScore": 0-5 (use 0.5 steps),
  "clarityScore": 0-5 (use 0.5 steps),
  "technicalAccuracy": 0-5 (use 0.5 steps),
  "terminologyUsage": 0-5 (use 0.5 steps),
  "tips": ["tip1", "tip2", "tip3", "tip4", "tip5"]
}

Formatting:
- betterWording (0-5): Grammar/English fixes use "You said: '[exact quote]'. Better: '[fix]'". Other improvements: brief (1 sentence). Can be empty if no improvements needed.
- dontForget (0-8): CRITICAL - If Expected Answer/Key Points provided: Return EXACT word-for-word phrases from the Expected Answer (character-by-character copy, preserve punctuation/capitalization/spacing). Do NOT paraphrase or reword. If no exact match found, return []. If no hint: specific missing points. Empty [] if all covered.
- dontForgetIndices (0-8, optional): If Expected Answer has numbered/bulleted points, return 0-based indices of missing points (e.g., [0, 2] means first and third points missing). Use this when hint is structured.
- whatWasRight (1-6): Specific correct points from their answer. At least 1 positive point, even for weak answers.
- tips (3-5): CRITICAL: Provide actionable, specific tips that address the weakest areas in their answer. Each tip should:
  1. Be specific to what's missing or weak (reference scores: technicalAccuracy, clarityScore, impactScore, etc.)
  2. Include concrete examples or before/after suggestions
  3. Focus on the most critical improvements first
  4. Reference specific parts of their answer when possible
  5. Be actionable (what to do, not just what's wrong)

Scoring (0-5, use 0.5 increments like 2.5, 3.5, 4.5 for nuance):
- answerQuality: 5=complete, 4=good, 3=partial, 2=tangential, 1=barely, 0=none
- technicalAccuracy: 5=deep, 4=good, 3=basic, 2=superficial, 1=errors, 0=wrong
- terminologyUsage: 5=precise, 4=good, 3=mixed, 2=generic, 1=few, 0=none
- clarityScore: 5=excellent, 4=good, 3=adequate, 2=unclear, 1=confusing, 0=incoherent
- starScore/impactScore: Use for behavioral/STAR questions only. Set to 3 for pure technical questions.

Scoring examples (calibrate your scoring to these):
- Strong (4-5): "At my previous role, I led a team of 8 engineers to migrate our monolith to microservices. I identified the 3 highest-risk services, created a phased migration plan, and we completed it in 4 months, reducing deploy time by 70%." → answerQuality:4.5, starScore:5, impactScore:4.5, clarity:4.5
- Mediocre (2-3): "Yeah so I worked on microservices before. We basically like broke things up into smaller pieces. It went pretty well I think, the team was happy with it." → answerQuality:2.5, starScore:2, impactScore:2, clarity:2.5
- Weak (0-1): "Um I'm not really sure, I haven't done that exactly." → answerQuality:0.5, starScore:0.5, impactScore:0.5, clarity:1

Context: ${coachingPrefs.priorities
		.slice(0, 3)
		.join(", ")}, ${getFocusAreaContext(
		coachingPrefs.focusAreas
	)}. Level: ${levelExpectation}.`;
}

/**
 * OPTIMIZATION: Extract exact word-for-word phrases from hint
 * This ensures consistency with CSV source material
 */
function extractDontForgetFromHint(
	dontForget: string[],
	dontForgetIndices: number[] | undefined,
	questionHint: string | null | undefined
): string[] {
	if (!questionHint) {
		return dontForget; // No hint, use AI-generated text
	}

	// Method 1: Use indices if provided (most reliable - exact extraction)
	if (dontForgetIndices && dontForgetIndices.length > 0) {
		const hintPoints = questionHint
			.split(/\n+|(?:\d+[\.\)]\s*)|(?:\-\s*)|(?:\*\s*)/)
			.map(p => p.trim())
			.filter(p => p.length > 10);
		
		if (hintPoints.length >= 2 && hintPoints.length <= 10) {
			// Extract exact phrases using indices - WORD FOR WORD from hint
			const extracted = dontForgetIndices
				.filter(idx => idx >= 0 && idx < hintPoints.length)
				.map(idx => hintPoints[idx])
				.filter(Boolean);
			
			if (extracted.length > 0) {
				return extracted; // Use exact phrases from hint
			}
		}
	}

	// Method 2: Find exact word-for-word matches in hint
	// This handles cases where AI copied verbatim but didn't use indices
	const exactMatches: string[] = [];
	
	for (const point of dontForget) {
		const pointTrimmed = point.trim();
		if (!pointTrimmed) continue;
		
		// Try exact match first (case-sensitive, preserving punctuation)
		if (questionHint.includes(pointTrimmed)) {
			exactMatches.push(pointTrimmed);
			continue;
		}
		
		// Try case-insensitive match
		const hintLower = questionHint.toLowerCase();
		const pointLower = pointTrimmed.toLowerCase();
		if (hintLower.includes(pointLower)) {
			// Find the exact original text (preserve case and punctuation)
			const startIdx = hintLower.indexOf(pointLower);
			if (startIdx !== -1) {
				const endIdx = startIdx + pointLower.length;
				const exactPhrase = questionHint.substring(startIdx, endIdx);
				exactMatches.push(exactPhrase);
				continue;
			}
		}
		
		// Try finding the phrase with normalized whitespace
		// Remove extra whitespace and compare
		const normalizedPoint = pointTrimmed.replace(/\s+/g, ' ').trim();
		const normalizedHint = questionHint.replace(/\s+/g, ' ');
		const normalizedHintLower = normalizedHint.toLowerCase();
		const normalizedPointLower = normalizedPoint.toLowerCase();
		
		if (normalizedHintLower.includes(normalizedPointLower)) {
			const startIdx = normalizedHintLower.indexOf(normalizedPointLower);
			if (startIdx !== -1) {
				const endIdx = startIdx + normalizedPointLower.length;
				// Extract from original hint (preserve original formatting)
				const exactPhrase = normalizedHint.substring(startIdx, endIdx);
				exactMatches.push(exactPhrase);
				continue;
			}
		}
		
		// Try partial match for longer phrases (find substring in hint)
		if (pointTrimmed.length > 30) {
			// For longer phrases, try to find a substantial substring match
			const words = pointTrimmed.split(/\s+/).filter(w => w.length > 3);
			if (words.length >= 3) {
				// Try to find a 3+ word sequence in the hint
				for (let i = 0; i <= words.length - 3; i++) {
					const sequence = words.slice(i, i + 3).join(' ');
					const sequenceLower = sequence.toLowerCase();
					if (hintLower.includes(sequenceLower)) {
						// Found a matching sequence - extract surrounding context from hint
						const startIdx = hintLower.indexOf(sequenceLower);
						if (startIdx !== -1) {
							// Extract a reasonable chunk around the matching sequence
							// Look for sentence boundaries or use fixed window
							const contextStart = Math.max(0, startIdx - 30);
							const contextEnd = Math.min(questionHint.length, startIdx + sequence.length + 100);
							
							// Try to find sentence boundaries for cleaner extraction
							const beforeText = questionHint.substring(contextStart, startIdx);
							const afterText = questionHint.substring(startIdx + sequence.length, contextEnd);
							
							// Find last sentence boundary before match
							const sentenceEndBefore = beforeText.match(/[.!?]\s+[^.!?]*$/);
							const actualStart = sentenceEndBefore 
								? contextStart + beforeText.lastIndexOf(sentenceEndBefore[0]) + sentenceEndBefore[0].length
								: contextStart;
							
							// Find first sentence boundary after match
							const sentenceEndAfter = afterText.match(/[.!?]\s+/);
							const actualEnd = sentenceEndAfter
								? startIdx + sequence.length + afterText.indexOf(sentenceEndAfter[0]) + sentenceEndAfter[0].length
								: contextEnd;
							
							const extractedPhrase = questionHint.substring(actualStart, actualEnd).trim();
							
							// Only use if it's a reasonable length and contains the sequence
							if (extractedPhrase.length >= sequence.length && extractedPhrase.length < 250) {
								exactMatches.push(extractedPhrase);
								break;
							}
						}
					}
				}
			}
		}
	}

	if (exactMatches.length > 0) {
		return exactMatches; // Return exact word-for-word matches from hint
	}

	// Method 3: If AI provided indices but we couldn't parse structured format,
	// try to match AI's text against hint and extract exact phrases
	if (dontForget.length > 0) {
		// Last resort: return empty array if we can't find exact matches
		// This ensures we only show points that are word-for-word from the hint
		// (Silently fail in production - better to show nothing than paraphrased text)
		return []; // Don't use paraphrased text - only exact matches
	}

	return dontForget; // Fallback only if no hint available
}

/**
 * Build optimized user prompt (condensed from ~1000 to ~300 tokens)
 */
function buildOptimizedUserPrompt(
	transcript: string,
	questionText?: string,
	questionHint?: string | null,
	questionTags: string[] = [],
	questionType?: string,
	metrics?: {
		wordCount: number;
		fillerCount: number;
		fillerRate: number;
		wpm: number;
		longPauses: number;
	}
): { prompt: string; hintPoints?: string[] } {
	const wordCount =
		metrics?.wordCount ||
		transcript
			.trim()
			.split(/\s+/)
			.filter((w) => w.length > 0).length;
	const fillerRate = metrics?.fillerRate || 0;
	const wpm = metrics?.wpm || 0;

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
	let hintPoints: string[] | undefined;
	let useStructured = false;

	if (questionText) {
		prompt += `Q: ${sanitizeForPrompt(questionText)}\n`;
	}
	if (questionHint) {
		// Sanitize hint before including in prompt
		const sanitizedHint = sanitizeForPrompt(questionHint);
		// OPTIMIZATION: Parse hint into structured points for reference-based responses
		// Split by common delimiters (numbered lists, bullets, line breaks)
		hintPoints = sanitizedHint
			.split(/\n+|(?:\d+[\.\)]\s*)|(?:\-\s*)|(?:\*\s*)/)
			.map(p => p.trim())
			.filter(p => p.length > 10); // Filter out very short fragments
		
		// Use full hint if structured parsing didn't work well
		useStructured = hintPoints.length >= 2 && hintPoints.length <= 10;
		
		if (useStructured) {
			// Provide structured hint with indices for reference
			prompt += `Expected Answer/Key Points (numbered for reference):\n`;
			hintPoints.forEach((point, idx) => {
				prompt += `${idx}. ${point}\n`;
			});
			prompt += `\nCRITICAL: For dontForget, you MUST return EXACT word-for-word phrases from the numbered points above. Copy them character-by-character, preserving punctuation, capitalization, and spacing. Do NOT paraphrase, summarize, or reword. Also provide dontForgetIndices array with 0-based indices of missing points (e.g., [0, 2] if points 1 and 3 are missing). If you cannot find an exact match, return empty array [].\n`;
		} else {
			// Use full hint (may be paragraph format)
			const hint =
				sanitizedHint.length > 500
					? sanitizedHint.substring(0, 500) + "..."
					: sanitizedHint;
			prompt += `Expected Answer/Key Points: ${hint}\n`;
			prompt += `CRITICAL: For dontForget, you MUST return EXACT word-for-word phrases from the Expected Answer above. Copy them character-by-character, preserving punctuation, capitalization, and spacing. Do NOT paraphrase, summarize, or reword. If you cannot find an exact match in the Expected Answer, return empty array []. This ensures consistency with the source material.\n`;
		}
	}
	if (questionTags.length > 0) {
		prompt += `Tags: ${questionTags.slice(0, 3).join(", ")}\n`; // Reduced to 3 tags
	}
	if (questionType) {
		const typeGuidance: Record<string, string> = {
			BEHAVIORAL: 'Type: Behavioral. Score using full STAR (Situation, Task, Action, Result). Weight impact highly.',
			DEFINITION: 'Type: Definition. STAR becomes structure/completeness score. Weight terminology highly.',
			TECHNICAL: 'Type: Technical. Weight technical accuracy + terminology highest. STAR becomes approach structure.',
			SCENARIO: 'Type: Scenario. Weight clarity + impact. Assess decision-making framework.',
			PITCH: 'Type: Pitch. Weight confidence + impact + conciseness highest. Assess time-awareness.',
		};
		prompt += `${typeGuidance[questionType] || ''}\n`;
	}

	prompt += `\nAnswer: ${processedTranscript}\n`;
	prompt += `Metrics: ${wordCount}w, ${fillerRate.toFixed(
		1
	)}% fillers, ${wpm}wpm\n`;
	
	// Add instruction to focus tips on weak areas
	prompt += `\nIMPORTANT: When generating tips, prioritize addressing the weakest scores (lowest rated areas). Make tips specific, actionable, and include examples.`;

	return { prompt, hintPoints: useStructured ? hintPoints : undefined };
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
	},
	questionType?: string
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
	const { prompt: userPrompt, hintPoints } = buildOptimizedUserPrompt(
		trimmedTranscript, // Use trimmed transcript
		questionText,
		questionHint,
		questionTags,
		questionType,
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

				if (process.env.NODE_ENV === "development") {
					console.log("Parsed JSON keys:", Object.keys(parsed));
					console.log(
						"Parsed JSON preview:",
						JSON.stringify(parsed).substring(0, 500)
					);
				}

				// Check if parsed object is empty or missing required fields
				if (!parsed || Object.keys(parsed).length === 0) {
					if (process.env.NODE_ENV === "development") {
						console.error("Parsed JSON is empty!");
					}
					throw new Error("OpenAI returned an empty JSON object");
				}
			} catch (parseError) {
				if (process.env.NODE_ENV === "development") {
					console.error("JSON parse error:", parseError);
					console.error("Response text (full):", fullText);
					console.error("Response length:", fullText.length);
				}

					// Try fallback: extract JSON if wrapped in markdown or other text
					try {
						const jsonMatch = fullText.match(/\{[\s\S]*\}/);
						if (jsonMatch && jsonMatch[0]) {
							if (process.env.NODE_ENV === "development") {
								console.log("Attempting fallback JSON extraction...");
							}
							parsed = JSON.parse(jsonMatch[0]);
							if (process.env.NODE_ENV === "development") {
								console.log(
									"Fallback extraction successful, keys:",
									Object.keys(parsed)
								);
							}
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
				if (process.env.NODE_ENV === "development") {
					console.error("Schema validation error:", schemaError);
					console.error("Parsed object:", JSON.stringify(parsed, null, 2));
					console.error(
						"Expected schema fields:",
						Object.keys(EnhancedAnalysisResponseSchema.shape)
					);
				}
				throw schemaError;
			}

			// OPTIMIZATION: Extract exact phrases from hint using indices/references
			// This reduces token usage and ensures consistency with CSV source
			const optimizedDontForget = extractDontForgetFromHint(
				validated.dontForget,
				validated.dontForgetIndices,
				questionHint
			);

			// Create optimized response with exact phrases from hint
			const optimizedResponse = {
				...validated,
				dontForget: optimizedDontForget,
				// Remove indices from response (internal optimization detail)
				dontForgetIndices: undefined,
			};

			// Cache the result (use trimmed transcript for cache key)
			analysisCache.set(
				trimmedTranscript, // Use trimmed transcript for cache
				questionId,
				questionTags,
				optimizedResponse,
				24 * 60 * 60 * 1000, // 24 hours TTL
				coachingPrefs as unknown as Record<string, unknown>
			);

			if (process.env.NODE_ENV === "development") {
				console.log("Optimized analysis completed", {
					questionAnswered: validated.questionAnswered,
					answerQuality: validated.answerQuality,
					dontForgetOptimized: optimizedDontForget.length !== validated.dontForget.length,
					cached: false,
				});
			}

			return optimizedResponse;
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
