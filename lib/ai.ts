import OpenAI from "openai";
import { z } from "zod";
import {
	CoachingPreferences,
	DEFAULT_PREFERENCES,
	getCoachingStylePrompt,
	getExperienceLevelContext,
	getFocusAreaContext,
	getFeedbackDepthInstructions,
} from "./coaching-config";

// Initialize OpenAI client with validation
const getOpenAIClient = () => {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		console.error("OPENAI_API_KEY is not set!");
		throw new Error("OPENAI_API_KEY environment variable is required");
	}
	return new OpenAI({
		apiKey,
	});
};

const openai = getOpenAIClient();

const AnalysisResponseSchema = z.object({
	starScore: z.number().int().min(0).max(5),
	impactScore: z.number().int().min(0).max(5),
	clarityScore: z.number().int().min(0).max(5),
	tips: z.array(z.string().max(16)).length(3),
});

export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;

export async function transcribeAudio(
	audioBlob: Blob,
	context?: {
		questionText?: string;
		questionTags?: string[];
	},
	options?: {
		includeWordTimestamps?: boolean; // Default: false for faster transcription
	}
): Promise<{
	transcript: string;
	words?: Array<{ word: string; start: number; end: number }>;
}> {
	const file = new File([audioBlob], "audio.webm", { type: "audio/webm" });
	const includeTimestamps = options?.includeWordTimestamps ?? false;

	// Build prompt with context to improve transcription accuracy
	// PRIORITY: Filler words instruction must be included (Whisper tends to remove them by default)
	// Whisper prompt max is ~200 chars, so we need to prioritize the filler word instruction

	// Start with the most important instruction: include filler words
	let prompt =
		"CRITICAL: Include ALL filler words exactly as spoken: um, uh, erm, er, like, you know, actually, basically, so, well, I mean, etc. Do NOT remove or clean them. ";

	// Add technical context if available (but keep it short to stay under 200 chars)
	if (context?.questionTags && context.questionTags.length > 0) {
		const tags = context.questionTags.slice(0, 5).join(", "); // Limit to 5 tags
		prompt += `Technical terms: ${tags}. `;
	}
	if (context?.questionText) {
		// Extract only the most important technical terms (limit to 3-4)
		const words = context.questionText.split(/\s+/);
		const technicalTerms = words
			.filter((word) => {
				const cleaned = word.replace(/[.,!?;:()]/g, "");
				return (
					cleaned.length > 3 &&
					(/^[A-Z][a-z]+/.test(cleaned) || /^[A-Z]{2,}$/.test(cleaned))
				);
			})
			.map((word) => word.replace(/[.,!?;:()]/g, ""))
			.filter((word, index, arr) => arr.indexOf(word) === index)
			.slice(0, 3) // Limit to top 3 terms to save space
			.join(", ");
		if (technicalTerms && prompt.length + technicalTerms.length < 180) {
			prompt += `Vocab: ${technicalTerms}. `;
		}
	}

	// Truncate to 200 chars max, but ensure filler word instruction is always included
	const maxPromptLength = 200;
	if (prompt.length > maxPromptLength) {
		// Keep the first part (filler words instruction) and truncate the rest
		const fillerInstruction =
			"CRITICAL: Include ALL filler words exactly as spoken: um, uh, erm, er, like, you know, actually, basically, so, well, I mean, etc. Do NOT remove or clean them. ";
		const remainingSpace = maxPromptLength - fillerInstruction.length;
		if (remainingSpace > 0) {
			prompt =
				fillerInstruction +
				prompt.substring(fillerInstruction.length, maxPromptLength);
		} else {
			prompt = fillerInstruction.substring(0, maxPromptLength);
		}
	}

	// Optimize: Skip word timestamps for faster transcription (we can estimate pauses from transcript)
	// Only request timestamps if explicitly needed (adds ~30-50% processing time)
	const response = await openai.audio.transcriptions.create({
		file: file,
		model: "whisper-1",
		language: "en", // Specify English for better accuracy
		response_format: includeTimestamps ? "verbose_json" : "json", // Simpler format when no timestamps
		...(includeTimestamps
			? { timestamp_granularities: ["word"] as const }
			: {}),
		...(prompt ? { prompt: prompt } : {}),
	});

	return {
		transcript: response.text,
		// Only include word timestamps if requested (they add processing time)
		...(includeTimestamps &&
		(
			response as {
				words?: Array<{ word: string; start: number; end: number }>;
			}
		).words
			? {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					words: (response as any).words?.map((w: any) => ({
						word: w.word,
						start: w.start,
						end: w.end,
					})),
			  }
			: {}),
	};
}

export async function analyzeTranscript(
	transcript: string,
	role: string = "Senior Design Engineer / Design Engineering Leader",
	priorities: string[] = [
		"clarity",
		"impact statements",
		"resilience",
		"accessibility",
		"performance",
	]
): Promise<AnalysisResponse> {
	const systemPrompt = `You are a concise interview coach.

Given a transcript, return strict JSON with:
- starScore 0..5 (Situation, Task, Action, Result present & balanced)
- impactScore 0..5 (metrics, outcomes, 'so what')
- clarityScore 0..5 (structure, concision)
- tips: array of 3 short actionable tips (<= 16 words each)

If the answer is too long or off-topic, reflect that in tips.

Return JSON only, no markdown, no explanation.`;

	const userPrompt = `Transcript:
${transcript}

Context:
- Role: ${role}
- Priorities: ${priorities.join(", ")}

Return JSON only.`;

	let attempts = 0;
	const maxAttempts = 3;

	while (attempts < maxAttempts) {
		try {
			const completion = await openai.chat.completions.create({
				model: "gpt-4o-mini",
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt },
				],
				response_format: { type: "json_object" },
				temperature: 0.3,
			});

			const content = completion.choices[0]?.message?.content;
			if (!content) {
				throw new Error("No content in response");
			}

			const parsed = JSON.parse(content);
			return AnalysisResponseSchema.parse(parsed);
		} catch {
			attempts++;
			if (attempts >= maxAttempts) {
				// Fallback: return basic scores
				return {
					starScore: 2,
					impactScore: 2,
					clarityScore: 2,
					tips: [
						"Could not analyze response",
						"Please try again",
						"Check your internet connection",
					],
				};
			}
			// Wait a bit before retry
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}

	throw new Error("Failed to analyze transcript after retries");
}

const EnhancedAnalysisResponseSchema = z.object({
	questionAnswered: z.boolean(),
	answerQuality: z.number().int().min(0).max(5),
	whatWasRight: z.array(z.string()).min(2).max(4), // Removed max(50) to allow longer strings
	whatWasWrong: z.array(z.string()).min(2).max(4), // Removed max(50) to allow longer strings
	betterWording: z.array(z.string()).min(2).max(3), // Removed max(50) to allow longer strings
	starScore: z.number().int().min(0).max(5),
	impactScore: z.number().int().min(0).max(5),
	clarityScore: z.number().int().min(0).max(5),
	technicalAccuracy: z.number().int().min(0).max(5),
	terminologyUsage: z.number().int().min(0).max(5),
	tips: z.array(z.string()).length(5), // Removed max(20) to allow longer tips
});

export type EnhancedAnalysisResponse = z.infer<
	typeof EnhancedAnalysisResponseSchema
>;

/**
 * Enhanced transcript analysis with technical knowledge assessment
 */
export async function analyzeTranscriptEnhanced(
	transcript: string,
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
	// Merge preferences with defaults
	const coachingPrefs: CoachingPreferences = {
		...DEFAULT_PREFERENCES,
		...preferences,
		role: role || preferences?.role || DEFAULT_PREFERENCES.role,
		priorities:
			priorities || preferences?.priorities || DEFAULT_PREFERENCES.priorities,
	};
	const stylePrompt = getCoachingStylePrompt(coachingPrefs.style);
	const experienceContext = getExperienceLevelContext(
		coachingPrefs.experienceLevel
	);
	const focusContext = getFocusAreaContext(coachingPrefs.focusAreas);
	const depthInstructions = getFeedbackDepthInstructions(
		coachingPrefs.feedbackDepth
	);

	const systemPrompt = `You are an expert interview coach specializing in technical interviews for ${
		coachingPrefs.experienceLevel
	} engineering roles with deep knowledge of industry best practices, common pitfalls, and effective feedback techniques.

${stylePrompt}

${experienceContext}

${focusContext}

Your role is to provide ${
		coachingPrefs.feedbackDepth
	}, actionable feedback that helps candidates improve their interview performance. Be specific and focus on actionable improvements.

**Industry Knowledge Base:**
- Technical interviews require: STAR method (Situation, Task, Action, Result), quantifiable metrics, domain-specific terminology, trade-off discussions, and learning reflection
- Common pitfalls: rambling without structure, no metrics, technical inaccuracies, weak STAR structure, excessive filler words (>5%), no trade-offs, no learning/reflection
- Domain terminology: Use precise terms (e.g., "reduced latency by implementing Redis caching" not "made it faster")
- Scoring benchmarks: ${coachingPrefs.experienceLevel} level expects ${
		coachingPrefs.experienceLevel === "junior"
			? "basic structure, fundamentals, learning mindset"
			: coachingPrefs.experienceLevel === "mid"
			? "good structure, some metrics, solid knowledge"
			: coachingPrefs.experienceLevel === "senior"
			? "excellent structure, strong metrics, deep expertise"
			: "perfect structure, strategic metrics, strategic vision"
	}

IMPORTANT: When analyzing the transcript, pay special attention to:
- Filler words: Count instances of "um", "uh", "like", "you know", "actually", "basically", "so", "well", "I mean", etc. Note patterns and frequency.
- Pacing: Note if there are excessive pauses (>800ms) or if the speaker is rushing. Assess if pacing matches the content complexity.
- Structure: Check if the answer follows STAR method (Situation, Task, Action, Result). Identify which components are missing or weak.
- Technical depth: Evaluate if the answer demonstrates real understanding vs. surface knowledge. Compare against expected answer/hint if provided.
- Impact: Look for specific metrics, numbers, percentages, time saved, revenue impact, user satisfaction, etc. The "so what" factor.
- Delivery: Assess confidence indicators (filler rate, pauses, word choice) and intonation patterns.

Given a transcript and question context, return strict JSON with:
- questionAnswered: boolean - Does the answer actually address the question asked? Check if key concepts from the question are covered.
- answerQuality: number 0..5 - Overall quality of the answer
  * 5: Fully answers question, accurate, well-structured, comprehensive
  * 4: Answers question well with minor gaps or inaccuracies
  * 3: Partially answers question but missing key points
  * 2: Tangentially related but doesn't directly answer
  * 1: Barely addresses the question
  * 0: Doesn't answer the question at all
- whatWasRight: array of strings (2-4 items) - Specific things the candidate got right or did well
- whatWasWrong: array of strings (2-4 items) - Specific things that were incorrect, missing, or could be improved
- betterWording: array of strings (2-3 items) - Specific suggestions for better wording, phrasing, or structure
- starScore 0..5 (Situation, Task, Action, Result present & balanced)
  **IMPORTANT**: STAR method is appropriate for behavioral/experience questions (e.g., "Tell me about a time when...", "Describe a situation where...", "Give an example of..."). 
  For factual/definition questions (e.g., "What is X?", "Explain Y", "Define Z"), flash card style questions, or technical concept questions, STAR is NOT appropriate. 
  In those cases, assess structure/clarity instead:
  * For behavioral questions: Use STAR scoring (0-5 based on Situation, Task, Action, Result)
  * For factual/definition questions: Score based on clarity, completeness, and organization (0-5)
    * 5: Clear, complete, well-organized answer with good structure
    * 4: Mostly clear and complete, minor organization issues
    * 3: Generally clear but missing some details or organization
    * 2: Unclear or incomplete, poor organization
    * 1: Very unclear or mostly incorrect
    * 0: No coherent answer
- impactScore 0..5 (metrics, outcomes, 'so what')
  * 5: Multiple specific metrics, clear business outcomes, strong "so what"
  * 4: Good metrics and outcomes, could be more specific
  * 3: Some metrics but vague or missing business context
  * 2: Few metrics, mostly qualitative
  * 1: No metrics, purely qualitative
  * 0: No impact statements
- clarityScore 0..5 (structure, concision)
  * 5: Concise, well-structured, easy to follow, no redundancy, appropriate length (200-300 words)
  * 4: Clear structure, minor redundancy or slightly too long/short
  * 3: Generally clear but some confusion, redundancy, or length issues
  * 2: Unclear structure, hard to follow
  * 1: Very unclear, rambling
  * 0: Incoherent
- technicalAccuracy 0..5 (technical correctness, use of appropriate concepts for the domain)
  * 5: Deep, accurate technical knowledge, correct concepts, demonstrates real understanding
  * 4: Good understanding with minor inaccuracies or missing details
  * 3: Basic understanding but lacks depth or has some inaccuracies
  * 2: Superficial or incorrect technical information
  * 1: Significant technical errors or misunderstanding
  * 0: No technical content or completely incorrect
- terminologyUsage 0..5 (appropriate use of domain-specific terms based on question tags)
  * 5: Uses precise, domain-appropriate terminology throughout, demonstrates expertise
  * 4: Good use of terminology with occasional imprecise terms
  * 3: Mix of appropriate and generic terms
  * 2: Mostly generic terms, lacks domain-specific language
  * 1: Very few or incorrect technical terms
  * 0: No technical terminology used
- tips: array of exactly 5 actionable tips (each tip can be up to 60 words, MUST include concrete examples):
  1. Question relevance tip - Did you answer the question? What's missing or off-topic? If they read the question, acknowledge that and suggest how to expand.
  2. Content/structure tip - specific to what's missing or weak in this answer:
     - For behavioral questions: Focus on STAR structure (Situation, Task, Action, Result) WITH EXAMPLES
     - For factual/definition questions: Focus on clarity, completeness, and organization WITH EXAMPLES
     - Include metrics where appropriate (e.g., "Add metrics like 'reduced latency by 60%' or 'handled 1M requests/day'")
  3. Technical accuracy tip - specific to the question domain WITH EXAMPLES (e.g., "Instead of 'database', say 'PostgreSQL with read replicas' or 'Redis cache with 5-minute TTL'")
  4. Delivery/confidence tip - address filler words, pacing, or confidence issues observed (specific counts/rates) WITH EXAMPLES (e.g., "Replace 'um'/'erm' with a 1-2 second pause")
  5. Specific improvement for this answer - what to change in this exact response (concrete, actionable) WITH BEFORE/AFTER EXAMPLES (e.g., "Instead of '[their vague phrase]', say '[specific example]'")

CRITICAL: You MUST return all required fields. The JSON must include:
- questionAnswered (boolean)
- answerQuality (number 0-5)
- whatWasRight (array of 2-4 strings)
- whatWasWrong (array of 2-4 strings)
- betterWording (array of 2-3 strings)
- starScore, impactScore, clarityScore, technicalAccuracy, terminologyUsage (all numbers 0-5)
- tips (array of exactly 5 strings)

For technicalAccuracy:
- 5: Demonstrates deep, accurate technical knowledge specific to the domain
- 4: Shows good understanding with minor inaccuracies or missing details
- 3: Basic understanding but lacks depth or has some inaccuracies
- 2: Superficial or incorrect technical information
- 1: Significant technical errors or misunderstanding
- 0: No technical content or completely incorrect

For terminologyUsage:
- 5: Uses precise, domain-appropriate terminology throughout
- 4: Good use of terminology with occasional imprecise terms
- 3: Mix of appropriate and generic terms
- 2: Mostly generic terms, lacks domain-specific language
- 1: Very few or incorrect technical terms
- 0: No technical terminology used

Return JSON only, no markdown, no explanation.`;

	// Build domain context from tags
	const domainContext =
		questionTags.length > 0
			? `Question Domain: ${questionTags.join(", ")}
    
For technical accuracy assessment, evaluate if the answer:
- Uses correct concepts and terminology for: ${questionTags.join(", ")}
- Demonstrates understanding of domain-specific principles
- Provides technically sound solutions or explanations
- Avoids common misconceptions in this domain`
			: "General technical question - assess overall technical accuracy.";

	// Build comprehensive context
	let questionContext = "";
	if (questionText) {
		questionContext += `Question: ${questionText}\n\n`;
	}
	if (questionHint) {
		questionContext += `Expected Answer/Hint: ${questionHint}\n\n`;
	}

	// Calculate metrics for context (if available from transcript analysis)
	const wordCount =
		metrics?.wordCount ||
		transcript
			.trim()
			.split(/\s+/)
			.filter((w) => w.length > 0).length;
	const fillerCount = metrics?.fillerCount || 0;
	const fillerRate = metrics?.fillerRate || 0;
	const wpm = metrics?.wpm || 0;
	const longPauses = metrics?.longPauses || 0;

	const userPrompt = `${questionContext}Transcript of Answer:
${transcript}

**Actual Transcript Metrics (use these for scoring):**
- Word count: ${wordCount} words
- Estimated length: ${
		wordCount > 0 ? Math.round(wordCount / 150) : 0
	} minutes (assuming ~150 WPM)
- Filler words: ${fillerCount} instances (${fillerRate.toFixed(1)}% of words)
- Words per minute: ${wpm} WPM
- Long pauses (>800ms): ${longPauses} pauses

**CRITICAL: Use these actual metrics to score the answer. Different answers should get different scores based on:**
- STAR structure quality (for behavioral questions) or clarity/organization (for factual questions)
- Presence and quality of metrics/impact statements
- Technical accuracy and terminology usage
- Overall answer quality relative to the question asked

Context:
- Target Role: ${coachingPrefs.role}
- Experience Level: ${coachingPrefs.experienceLevel}
- Priorities: ${coachingPrefs.priorities.join(", ")}
- Focus Areas: ${coachingPrefs.focusAreas.join(", ")}
${domainContext}

Question Tags: ${
		questionTags.length > 0
			? questionTags.join(", ")
			: "general (no specific domain)"
	}

${depthInstructions}

**Analysis Framework:**
**CRITICAL: First, assess if the question was actually answered. Distinguish between "lacking depth" (fundamentally missing content/knowledge) vs "room for improvement" (has content but could be enhanced).**

1. Question Relevance: Does the answer address the specific question asked? Identify:
   - Key concepts from the question that should be covered
   - Whether the answer directly responds to what was asked
   - If the answer is off-topic or only tangentially related
   - What specific parts of the question were answered vs. missed
   - **IMPORTANT**: If the candidate read/repeated the question, that shows they understand it - this is NOT "lacking depth" but rather "room for improvement" in how they expand on it

2. What Was Right: Identify 2-4 specific things the candidate got right (be generous - acknowledge effort):
   - Correct technical concepts or facts
   - Good examples or explanations
   - Appropriate use of terminology
   - Well-structured parts of the answer
   - Effective use of STAR method (if applicable)
   - If they addressed the question directly (even if verbatim), acknowledge that

3. What Needs Improvement: Identify 2-4 specific areas for improvement (distinguish between missing content vs. enhancement opportunities):
   - **Missing content**: Only flag if key concepts are completely absent
   - **Enhancement opportunities**: If they have the basics but could add metrics, examples, depth, structure
   - **Structure**: If organization could be clearer
   - **Specificity**: If vague terms could be more precise
   - **Examples**: If concrete examples would strengthen the answer
   - **IMPORTANT**: If they read the question, say "You correctly identified the question. Now expand with..." NOT "You lack depth"

4. Better Wording: Provide 2-3 specific suggestions with CONCRETE EXAMPLES:
   - Replace vague terms with specific ones (e.g., "improved performance" → "reduced latency from 500ms to 50ms")
   - Improve sentence structure with examples (e.g., "Instead of 'I did X', say 'I implemented X by Y, which resulted in Z'")
   - Add missing transitions with examples (e.g., "Add: 'To accomplish this, I...' or 'The results were...'")
   - Clarify confusing statements with rewrites (e.g., "Instead of '[vague statement]', say '[specific statement]'")
   - Use more precise terminology with examples (e.g., "Instead of 'database', say 'PostgreSQL with read replicas'")

Then assess speaking quality AND technical knowledge depth:

5. Technical accuracy - does the answer demonstrate correct understanding of concepts related to the question tags? Compare against the expected answer/hint if provided.
6. Terminology usage - does the answer use appropriate domain-specific terms from the question tags?
7. Content quality - STAR structure (Situation, Task, Action, Result), impact statements with metrics, and clarity
8. Filler words - count and note excessive use of "um", "uh", "like", "you know", "actually", "basically", "so", "well", "I mean", etc.
9. Pacing and pauses - assess if pauses are natural or indicate uncertainty. Note if the speaker is rushing or too slow.
10. Structure - is the answer well-organized with clear beginning, middle, and end?

When providing tips, be specific, actionable, and reference the transcript. Use these feedback templates:

**For filler words (analyze actual filler count and rate):**
- If filler rate > 5%: "You used filler words like 'um' and 'like' frequently ([X] instances, [Y]% of words). This undermines confidence. Practice: (1) Record yourself and count fillers, (2) Replace fillers with 1-2 second pauses, (3) Practice answer structure beforehand. Aim for <2 fillers per 100 words."
- If filler rate 2-5%: "You have some filler words ([X] instances). Practice replacing 'um'/'like' with brief pauses to sound more confident."
- If filler rate <2%: "Good job minimizing filler words! Your speech is clear and confident."

**For STAR structure (ONLY for behavioral/experience questions - "Tell me about a time when...", "Describe a situation...", etc.):**
**If the question is factual/definitional (e.g., "What is X?", "Explain Y", "Define Z"), DO NOT use STAR feedback. Instead, focus on clarity, completeness, and organization.**

- Missing Situation: "Your answer jumps into action without context. Start with: 'In my previous role at [Company], we faced [specific problem] that was impacting [business metric].'"
- Missing Task: "Clarify what needed to be accomplished. State: 'I was tasked with [specific objective] within [constraints].'"
- Missing Action: "Detail what YOU specifically did. Use 'I' statements: 'I implemented [solution] by [method], I analyzed [data], I collaborated with [team] to [action].' Avoid 'we' - focus on your contributions."
- Missing Result: "End with measurable outcomes: 'This resulted in [specific metric], which [business impact].' Examples: reduced latency by 60%, increased conversion by 15%, saved $50K annually."
- Weak transitions: "Your STAR components are present but transitions are unclear. Use: 'The situation was...', 'My task was to...', 'To accomplish this, I...', 'The results were...'"

**For factual/definition questions (NOT behavioral):**
- Focus on clarity: "Organize your answer with: (1) Definition/overview, (2) Key characteristics or components, (3) Examples or use cases, (4) Conclusion or summary."
- Focus on completeness: "Your answer covers [X] but is missing [Y]. Add: [specific missing element]."
- Focus on structure: "Use signposts: 'First, X is...', 'Second, it has these characteristics...', 'For example...', 'In summary...'"

**For metrics & impact (check for numbers and business connection - ALWAYS provide examples):**
- No metrics: "Your answer lacks quantifiable impact. Include specific examples: percentages (e.g., 'reduced error rate by 60%'), time (e.g., 'reduced page load from 2s to 0.5s'), money (e.g., 'saved $50K annually'), scale (e.g., 'handled 1M requests/day'), or user impact (e.g., 'improved NPS from 40 to 65')."
- Vague metrics: "Be more specific with concrete examples. Instead of 'improved performance', say 'reduced page load time from 3.5s to 0.8s' or 'increased API throughput from 1K to 5K requests/second'."
- Missing business impact: "You have technical metrics but not business impact. Connect to outcomes with examples: 'This reduced server costs by 30%, saving $50K annually' or 'increased user conversion by 22%, generating $200K in additional revenue'."

**For technical accuracy (evaluate correctness and depth - distinguish between missing vs. enhancement):**
- Incorrect concepts: "Your explanation of [concept] is incorrect. [Correct explanation with example]. Review core concepts for [domain] before your next interview. Example: [provide a correct example]."
- Surface-level (if they have basics): "Your answer demonstrates understanding but could go deeper. Expand with examples: explain why you chose [technology] (e.g., 'I chose Redis because it provides sub-millisecond latency'), what trade-offs you considered (e.g., 'I traded memory cost for speed'), alternative approaches (e.g., 'I also considered Memcached but Redis had better persistence'), and how you validated (e.g., 'I load-tested with 10K concurrent users')."
- Missing technical details: "Add more technical specifics with concrete examples. Instead of 'I optimized the database', say 'I optimized queries by adding composite indexes on user_id and created_at columns, which reduced query time from 500ms to 50ms for the user activity feed'."
- **IMPORTANT**: If they read/repeated the question, they understand it - focus on "how to expand" not "you lack depth"

**For terminology (check for domain-specific vs generic terms):**
- Generic terms: "Use domain-specific language. Instead of 'made it faster', say 'reduced latency by implementing Redis caching with TTL of 5 minutes' or 'optimized queries using composite indexes on user_id and created_at'."
- Incorrect terminology: "You used '[term]' incorrectly. The correct term is '[correct term]', which means [definition]."
- Missing technical terms: "Incorporate more domain-specific terminology. For [domain], use terms like: [list relevant terms from question tags]."

**For pacing & delivery (analyze WPM and pause patterns):**
- Too fast (>180 WPM): "You're speaking too quickly ([X] WPM). Slow down and pause between key points. Aim for 120-150 WPM. Practice: take a breath between sentences, pause after stating metrics."
- Too slow (<100 WPM or many long pauses): "Your pacing is slow with many pauses ([X] WPM, [Y] long pauses). Practice speaking more fluidly while maintaining clarity."
- Inconsistent: "Your pacing varies - fast in some parts, slow in others. Maintain consistent rhythm."

**For confidence (analyze filler rate, pauses, word choice):**
- Low confidence: "Your frequent pauses ([X] long pauses) and filler words ([Y] instances) suggest uncertainty. Practice your answer structure beforehand and speak with conviction. You're the expert in your experience."
- Overconfidence: "While confidence is good, avoid sounding dismissive of challenges or trade-offs. Acknowledge complexity and show thoughtful consideration."

**For structure & clarity (evaluate organization and length):**
- Unclear organization: "Your answer lacks clear structure. Organize with: (1) Brief context, (2) Main points in logical order, (3) Supporting details, (4) Conclusion with impact. Use signposts: 'First, I...', 'Then, I...', 'Finally, I...'"
- Too long (>400 words or >3 minutes): "Your answer is too long ([X] words). Aim for 2-3 minutes (200-300 words). Practice being concise: focus on key points, cut unnecessary details."
- Too short (<150 words): "Your answer is too brief ([X] words). Expand with: (1) More context in Situation, (2) Specific steps in Action, (3) Detailed metrics in Result."
- Redundancy: "You repeated the same points multiple times. Be concise: state each point once with supporting details, then move on."

**Additional considerations:**
- If no trade-offs discussed: "Always discuss pros/cons, alternatives considered, and why you chose this approach. This shows critical thinking."
- If no learning/reflection: "End with 'What I learned' or 'What I'd do differently' to show growth mindset."
- Compare against expected answer/hint if provided: "The expected answer includes [key points]. Your answer [matches/misses] these points. [Specific guidance]."

Return JSON only.`;

	let attempts = 0;
	const maxAttempts = 3;

	while (attempts < maxAttempts) {
		try {
			console.log(`AI analysis attempt ${attempts + 1}/${maxAttempts}...`);
			console.log(
				"Prompt length:",
				userPrompt.length,
				"System prompt length:",
				systemPrompt.length
			);

			const completion = await openai.chat.completions.create({
				model: "gpt-4o-mini",
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt },
				],
				response_format: { type: "json_object" },
				temperature: 0.5, // Increased from 0.3 to allow more variation in scoring
				max_tokens: 2500, // Increased for more detailed analysis (questionAnswered, whatWasRight/Wrong, betterWording)
			});

			console.log("OpenAI API call successful");

			const content = completion.choices[0]?.message?.content;
			if (!content) {
				console.error("OpenAI returned empty content");
				throw new Error("No content in response from OpenAI");
			}

			// Log for debugging (truncate if too long)
			const logContent =
				content.length > 500 ? content.substring(0, 500) + "..." : content;
			console.log("OpenAI response received (first 500 chars):", logContent);
			console.log("Full response length:", content.length);

			let parsed;
			try {
				parsed = JSON.parse(content);
			} catch (parseError) {
				console.error("JSON parse error:", parseError);
				console.error(
					"Content that failed to parse:",
					content.substring(0, 1000)
				);
				throw new Error(
					`Failed to parse JSON: ${
						parseError instanceof Error ? parseError.message : "Unknown error"
					}`
				);
			}

			// Validate with schema
			try {
				const validated = EnhancedAnalysisResponseSchema.parse(parsed);
				console.log("Schema validation passed");
				console.log("AI returned scores:", {
					starScore: validated.starScore,
					impactScore: validated.impactScore,
					clarityScore: validated.clarityScore,
					technicalAccuracy: validated.technicalAccuracy,
					terminologyUsage: validated.terminologyUsage,
					answerQuality: validated.answerQuality,
				});
				return validated;
			} catch (validationError) {
				console.error("Schema validation error:", validationError);
				console.error("Parsed content keys:", Object.keys(parsed || {}));
				console.error(
					"Parsed content:",
					JSON.stringify(parsed, null, 2).substring(0, 2000)
				);

				// Try to provide helpful error message
				if (validationError instanceof z.ZodError) {
					const missingFields = validationError.issues
						.map((issue) => issue.path.join("."))
						.join(", ");
					console.error("Missing or invalid fields:", missingFields);
					throw new Error(
						`Schema validation failed. Missing/invalid fields: ${missingFields}. Full error: ${validationError.message}`
					);
				}
				throw new Error(
					`Schema validation failed: ${
						validationError instanceof Error
							? validationError.message
							: "Unknown error"
					}`
				);
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			const errorStack = error instanceof Error ? error.stack : undefined;
			console.error(`Analysis attempt ${attempts + 1} failed:`, errorMessage);
			if (errorStack) {
				console.error("Error stack:", errorStack);
			}
			attempts++;

			if (attempts >= maxAttempts) {
				// Log the error for debugging
				console.error(
					"All analysis attempts failed. Last error:",
					errorMessage
				);
				console.error("Transcript length:", transcript.length);
				console.error("Transcript preview:", transcript.substring(0, 300));

				// Return more helpful fallback based on transcript length
				const hasContent = transcript.trim().length > 10;
				const wordCount = transcript
					.trim()
					.split(/\s+/)
					.filter((w) => w.length > 0).length;
				return {
					questionAnswered: wordCount > 20, // Likely answered if substantial content
					answerQuality: hasContent ? 2 : 1,
					whatWasRight: hasContent
						? [
								"Your response was recorded successfully",
								"You provided some content",
						  ]
						: ["Recording was successful", "Audio quality was good"],
					whatWasWrong: hasContent
						? [
								"AI analysis temporarily unavailable - unable to assess answer quality",
								"Unable to verify if question was fully answered",
						  ]
						: [
								"Response is too brief to analyze",
								"Please provide more detailed answer",
						  ],
					betterWording: [
						"Try speaking for 2-3 minutes with clear structure",
						"Use the STAR method: Situation, Task, Action, Result",
						"Include specific metrics and examples",
					],
					starScore: hasContent ? 2 : 1,
					impactScore: hasContent ? 2 : 1,
					clarityScore: hasContent ? 2 : 1,
					technicalAccuracy: hasContent ? 2 : 1,
					terminologyUsage: hasContent ? 2 : 1,
					tips: hasContent
						? [
								"AI analysis temporarily unavailable",
								"Your response was recorded successfully",
								"Try speaking more clearly and structure your answer",
								"Use the STAR method: Situation, Task, Action, Result",
								"Include specific metrics and outcomes when possible",
						  ]
						: [
								"Please provide a longer response",
								"Try speaking for at least 30 seconds",
								"Structure your answer with clear examples",
								"Include specific details and outcomes",
								"Practice speaking clearly and confidently",
						  ],
				};
			}
			// Exponential backoff for retries
			await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
		}
	}

	throw new Error("Failed to analyze transcript after retries");
}
