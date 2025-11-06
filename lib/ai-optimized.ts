/**
 * Optimized AI analysis functions with:
 * - Condensed prompts (70% token reduction)
 * - Caching support
 * - Ready for streaming (can be added later)
 */

import OpenAI from 'openai';
import { z } from 'zod';
import {
  CoachingPreferences,
  DEFAULT_PREFERENCES,
  getCoachingStylePrompt,
  getExperienceLevelContext,
  getFocusAreaContext,
  getFeedbackDepthInstructions,
} from './coaching-config';
import { analysisCache } from './ai-cache';

// Initialize OpenAI client
const getOpenAIClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }
  return new OpenAI({ apiKey });
};

const openai = getOpenAIClient();

const EnhancedAnalysisResponseSchema = z.object({
  questionAnswered: z.boolean(),
  answerQuality: z.number().int().min(0).max(5),
  whatWasRight: z.array(z.string()).min(2).max(4),
  betterWording: z.array(z.string()).min(2).max(3),
  starScore: z.number().int().min(0).max(5),
  impactScore: z.number().int().min(0).max(5),
  clarityScore: z.number().int().min(0).max(5),
  technicalAccuracy: z.number().int().min(0).max(5),
  terminologyUsage: z.number().int().min(0).max(5),
  tips: z.array(z.string()).length(5),
});

export type EnhancedAnalysisResponse = z.infer<typeof EnhancedAnalysisResponseSchema>;

/**
 * Build optimized system prompt (condensed from ~2000 to ~600 tokens)
 */
function buildOptimizedSystemPrompt(
  coachingPrefs: CoachingPreferences
): string {
  const style = getCoachingStylePrompt(coachingPrefs.style);
  const level = coachingPrefs.experienceLevel;
  const levelExpectation = 
    level === 'junior' ? 'basics, fundamentals, learning' :
    level === 'mid' ? 'solid knowledge, some metrics' :
    level === 'senior' ? 'deep expertise, strong metrics' :
    'strategic vision, executive presence';

  return `Expert ${level} interview coach. ${style}

Score 0-5: questionAnswered (bool), answerQuality, starScore (STAR/behavioral, clarity/factual), impactScore, clarityScore, technicalAccuracy, terminologyUsage.

Output: whatWasRight (2-4), betterWording (2-3), tips (5 with examples).

Context: ${coachingPrefs.priorities.slice(0, 3).join(', ')}, ${getFocusAreaContext(coachingPrefs.focusAreas)}. Expect: ${levelExpectation}.

Scoring: answerQuality (5=complete, 4=good, 3=partial, 2=tangential, 1=barely, 0=none), starScore (5=full STAR, 4=good, 3=partial, 2=weak, 1=minimal, 0=none), impactScore (5=metrics+business, 4=good, 3=some, 2=few, 1=qualitative, 0=none), technicalAccuracy (5=deep, 4=good, 3=basic, 2=superficial, 1=errors, 0=wrong), terminologyUsage (5=precise, 4=good, 3=mixed, 2=generic, 1=few, 0=none).

Return JSON only.`;
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
  },
  coachingPrefs?: CoachingPreferences
): string {
  const wordCount = metrics?.wordCount || transcript.trim().split(/\s+/).filter(w => w.length > 0).length;
  const fillerCount = metrics?.fillerCount || 0;
  const fillerRate = metrics?.fillerRate || 0;
  const wpm = metrics?.wpm || 0;
  const longPauses = metrics?.longPauses || 0;

  // OPTIMIZE: Truncate very long transcripts to reduce token usage and speed
  // Keep first 800 words (most important context) and last 200 words (conclusion)
  const MAX_TRANSCRIPT_WORDS = 1000; // Limit transcript to ~1000 words for faster processing
  let processedTranscript = transcript;
  if (wordCount > MAX_TRANSCRIPT_WORDS) {
    const words = transcript.split(/\s+/);
    const firstPart = words.slice(0, 800).join(' ');
    const lastPart = words.slice(-200).join(' ');
    processedTranscript = `${firstPart}... [${wordCount - 1000} words omitted] ...${lastPart}`;
    console.log(`Truncated transcript from ${wordCount} to ~1000 words for faster processing`);
  }

  let prompt = '';
  
  if (questionText) {
    prompt += `Q: ${questionText}\n`;
  }
  if (questionHint) {
    prompt += `Expected: ${questionHint.substring(0, 200)}\n`; // Truncate hint if too long
  }
  if (questionTags.length > 0) {
    prompt += `Domain: ${questionTags.slice(0, 5).join(', ')}\n`; // Limit to 5 tags
  }
  
  prompt += `\nAnswer: ${processedTranscript}\n\n`;
  prompt += `Metrics: ${wordCount}w, ${fillerCount}f (${fillerRate.toFixed(1)}%), ${wpm}wpm, ${longPauses}p.\n`;
  prompt += `Score: relevance, quality, STAR/clarity, impact, technical, terminology. Tips with examples.`;

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
  // Merge preferences
  const coachingPrefs: CoachingPreferences = {
    ...DEFAULT_PREFERENCES,
    ...preferences,
    role: role || preferences?.role || DEFAULT_PREFERENCES.role,
    priorities: priorities || preferences?.priorities || DEFAULT_PREFERENCES.priorities,
  };

  // Check cache first
  const cacheKey = {
    transcript,
    questionId,
    questionTags,
    preferences: coachingPrefs,
  };
  const cached = analysisCache.get<EnhancedAnalysisResponse>(
    transcript,
    questionId,
    questionTags,
    coachingPrefs as unknown as Record<string, unknown>
  );
  
  if (cached) {
    console.log('Using cached analysis result');
    return cached;
  }

  // Build optimized prompts
  const systemPrompt = buildOptimizedSystemPrompt(coachingPrefs);
  const userPrompt = buildOptimizedUserPrompt(
    transcript,
    questionText,
    questionHint,
    questionTags,
    metrics,
    coachingPrefs
  );

  console.log('Optimized prompt lengths:', {
    system: systemPrompt.length,
    user: userPrompt.length,
    estimatedTokens: Math.ceil((systemPrompt.length + userPrompt.length) / 4), // Rough estimate: 4 chars per token
  });

  let attempts = 0;
  const maxAttempts = 2; // Reduced from 3 for faster failure recovery

  while (attempts < maxAttempts) {
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3, // Lower temperature = faster, more deterministic generation
        max_tokens: 1200, // Further reduced (optimized prompts + structured output need less)
      });

      const fullText = completion.choices[0]?.message?.content;
      if (!fullText) {
        throw new Error('No content in response from OpenAI');
      }

      // Parse JSON response
      let parsed;
      try {
        // Try to extract JSON from response (in case there's extra text)
        const jsonMatch = fullText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          parsed = JSON.parse(fullText);
        }
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        console.error('Response text:', fullText.substring(0, 500));
        throw new Error(`Failed to parse JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
      }

      // Validate with schema
      const validated = EnhancedAnalysisResponseSchema.parse(parsed);
      
      // Cache the result
      analysisCache.set(
        transcript,
        questionId,
        questionTags,
        validated,
        24 * 60 * 60 * 1000, // 24 hours TTL
        coachingPrefs as unknown as Record<string, unknown>
      );

      console.log('Optimized analysis completed', {
        questionAnswered: validated.questionAnswered,
        answerQuality: validated.answerQuality,
        cached: false,
      });

      return validated;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Optimized analysis attempt ${attempts + 1} failed:`, errorMessage);
      attempts++;
      
      if (attempts >= maxAttempts) {
        // Return fallback
        const wordCount = metrics?.wordCount || transcript.trim().split(/\s+/).filter(w => w.length > 0).length;
        const fallback: EnhancedAnalysisResponse = {
          questionAnswered: wordCount > 20,
          answerQuality: 2,
          whatWasRight: [
            'Your response was recorded successfully',
            'You provided some content',
          ],
          betterWording: [
            'Try speaking for 2-3 minutes with clear structure',
            'Use the STAR method: Situation, Task, Action, Result',
            'Include specific metrics and examples',
          ],
          starScore: 2,
          impactScore: 2,
          clarityScore: 2,
          technicalAccuracy: 2,
          terminologyUsage: 2,
          tips: [
            `AI analysis error: ${errorMessage}`,
            'Your response was recorded successfully',
            'Review your transcript and practice speaking more clearly',
            'Use the STAR method: Situation, Task, Action, Result',
            'Include specific metrics and outcomes when possible',
          ],
        };
        return fallback;
      }
      
      // Exponential backoff (reduced delay for faster recovery)
      await new Promise((resolve) => setTimeout(resolve, 500 * attempts)); // Reduced from 1000ms
    }
  }

  throw new Error('Failed to analyze transcript after retries');
}

// Streaming support can be added later using Vercel AI SDK
// For now, we use the optimized non-streaming version which is faster due to caching

