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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const AnalysisResponseSchema = z.object({
  starScore: z.number().int().min(0).max(5),
  impactScore: z.number().int().min(0).max(5),
  clarityScore: z.number().int().min(0).max(5),
  tips: z.array(z.string().max(16)).length(3),
});

export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;

export async function transcribeAudio(audioBlob: Blob): Promise<{
  transcript: string;
  words?: Array<{ word: string; start: number; end: number }>;
}> {
  const file = new File([audioBlob], 'audio.webm', { type: 'audio/webm' });

  const response = await openai.audio.transcriptions.create({
    file: file,
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['word'],
  });

  return {
    transcript: response.text,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    words: (response as any).words?.map((w: any) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    })),
  };
}

export async function analyzeTranscript(
  transcript: string,
  role: string = 'Senior Design Engineer / Design Engineering Leader',
  priorities: string[] = [
    'clarity',
    'impact statements',
    'resilience',
    'accessibility',
    'performance',
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
- Priorities: ${priorities.join(', ')}

Return JSON only.`;

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content in response');
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
            'Could not analyze response',
            'Please try again',
            'Check your internet connection',
          ],
        };
      }
      // Wait a bit before retry
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error('Failed to analyze transcript after retries');
}

const EnhancedAnalysisResponseSchema = z.object({
  starScore: z.number().int().min(0).max(5),
  impactScore: z.number().int().min(0).max(5),
  clarityScore: z.number().int().min(0).max(5),
  technicalAccuracy: z.number().int().min(0).max(5),
  terminologyUsage: z.number().int().min(0).max(5),
  tips: z.array(z.string().max(20)).length(5),
});

export type EnhancedAnalysisResponse = z.infer<typeof EnhancedAnalysisResponseSchema>;

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
  preferences?: Partial<CoachingPreferences>
): Promise<EnhancedAnalysisResponse> {
  // Merge preferences with defaults
  const coachingPrefs: CoachingPreferences = {
    ...DEFAULT_PREFERENCES,
    ...preferences,
    role: role || preferences?.role || DEFAULT_PREFERENCES.role,
    priorities: priorities || preferences?.priorities || DEFAULT_PREFERENCES.priorities,
  };
  const stylePrompt = getCoachingStylePrompt(coachingPrefs.style);
  const experienceContext = getExperienceLevelContext(coachingPrefs.experienceLevel);
  const focusContext = getFocusAreaContext(coachingPrefs.focusAreas);
  const depthInstructions = getFeedbackDepthInstructions(coachingPrefs.feedbackDepth);

  const systemPrompt = `You are an expert interview coach specializing in technical interviews for ${coachingPrefs.experienceLevel} engineering roles with deep knowledge of industry best practices, common pitfalls, and effective feedback techniques.

${stylePrompt}

${experienceContext}

${focusContext}

Your role is to provide ${coachingPrefs.feedbackDepth}, actionable feedback that helps candidates improve their interview performance. Be specific and focus on actionable improvements.

**Industry Knowledge Base:**
- Technical interviews require: STAR method (Situation, Task, Action, Result), quantifiable metrics, domain-specific terminology, trade-off discussions, and learning reflection
- Common pitfalls: rambling without structure, no metrics, technical inaccuracies, weak STAR structure, excessive filler words (>5%), no trade-offs, no learning/reflection
- Domain terminology: Use precise terms (e.g., "reduced latency by implementing Redis caching" not "made it faster")
- Scoring benchmarks: ${coachingPrefs.experienceLevel} level expects ${coachingPrefs.experienceLevel === 'junior' ? 'basic structure, fundamentals, learning mindset' : coachingPrefs.experienceLevel === 'mid' ? 'good structure, some metrics, solid knowledge' : coachingPrefs.experienceLevel === 'senior' ? 'excellent structure, strong metrics, deep expertise' : 'perfect structure, strategic metrics, strategic vision'}

IMPORTANT: When analyzing the transcript, pay special attention to:
- Filler words: Count instances of "um", "uh", "like", "you know", "actually", "basically", "so", "well", "I mean", etc. Note patterns and frequency.
- Pacing: Note if there are excessive pauses (>800ms) or if the speaker is rushing. Assess if pacing matches the content complexity.
- Structure: Check if the answer follows STAR method (Situation, Task, Action, Result). Identify which components are missing or weak.
- Technical depth: Evaluate if the answer demonstrates real understanding vs. surface knowledge. Compare against expected answer/hint if provided.
- Impact: Look for specific metrics, numbers, percentages, time saved, revenue impact, user satisfaction, etc. The "so what" factor.
- Delivery: Assess confidence indicators (filler rate, pauses, word choice) and intonation patterns.

Given a transcript and question context, return strict JSON with:
- starScore 0..5 (Situation, Task, Action, Result present & balanced)
  * 5: All four components present, balanced, well-structured with clear transitions
  * 4: All components present but one is weaker or transitions need work
  * 3: Three components present, missing or weak in one area
  * 2: Two components present, missing significant parts
  * 1: One component present, mostly unstructured
  * 0: No clear structure, rambling
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
- tips: array of 5 actionable tips ${depthInstructions}:
  1. Content/structure tip - specific to what's missing or weak in this answer (STAR, metrics, organization)
  2. Technical accuracy tip - specific to the question domain and expected answer (correctness, depth, concepts)
  3. Delivery/confidence tip - address filler words, pacing, or confidence issues observed (specific counts/rates)
  4. Specific improvement for this answer - what to change in this exact response (concrete, actionable)
  5. General speaking skill tip - broader improvement for future answers (practice techniques, mindset)

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
  const domainContext = questionTags.length > 0 
    ? `Question Domain: ${questionTags.join(', ')}
    
For technical accuracy assessment, evaluate if the answer:
- Uses correct concepts and terminology for: ${questionTags.join(', ')}
- Demonstrates understanding of domain-specific principles
- Provides technically sound solutions or explanations
- Avoids common misconceptions in this domain`
    : 'General technical question - assess overall technical accuracy.';

  // Build comprehensive context
  let questionContext = '';
  if (questionText) {
    questionContext += `Question: ${questionText}\n\n`;
  }
  if (questionHint) {
    questionContext += `Expected Answer/Hint: ${questionHint}\n\n`;
  }

  // Calculate metrics for context (if available from transcript analysis)
  const wordCount = transcript.trim().split(/\s+/).filter(w => w.length > 0).length;
  
  const userPrompt = `${questionContext}Transcript of Answer:
${transcript}

**Transcript Analysis:**
- Word count: ${wordCount} words
- Estimated length: ${wordCount > 0 ? Math.round(wordCount / 150) : 0} minutes (assuming ~150 WPM)
- Filler words detected: [Count instances of: um, uh, like, you know, actually, basically, so, well, I mean, etc.]
- Long pauses: [Identify pauses >800ms if word timestamps available, otherwise note natural pause patterns]

Context:
- Target Role: ${coachingPrefs.role}
- Experience Level: ${coachingPrefs.experienceLevel}
- Priorities: ${coachingPrefs.priorities.join(', ')}
- Focus Areas: ${coachingPrefs.focusAreas.join(', ')}
${domainContext}

Question Tags: ${questionTags.length > 0 ? questionTags.join(', ') : 'general (no specific domain)'}

${depthInstructions}

**Analysis Framework:**
Assess both speaking quality AND technical knowledge depth. Pay special attention to:

1. Technical accuracy - does the answer demonstrate correct understanding of concepts related to the question tags? Compare against the expected answer/hint if provided.
2. Terminology usage - does the answer use appropriate domain-specific terms from the question tags?
3. Content quality - STAR structure (Situation, Task, Action, Result), impact statements with metrics, and clarity
4. Filler words - count and note excessive use of "um", "uh", "like", "you know", "actually", "basically", "so", "well", "I mean", etc.
5. Pacing and pauses - assess if pauses are natural or indicate uncertainty. Note if the speaker is rushing or too slow.
6. Structure - is the answer well-organized with clear beginning, middle, and end?

When providing tips, be specific, actionable, and reference the transcript. Use these feedback templates:

**For filler words (analyze actual filler count and rate):**
- If filler rate > 5%: "You used filler words like 'um' and 'like' frequently ([X] instances, [Y]% of words). This undermines confidence. Practice: (1) Record yourself and count fillers, (2) Replace fillers with 1-2 second pauses, (3) Practice answer structure beforehand. Aim for <2 fillers per 100 words."
- If filler rate 2-5%: "You have some filler words ([X] instances). Practice replacing 'um'/'like' with brief pauses to sound more confident."
- If filler rate <2%: "Good job minimizing filler words! Your speech is clear and confident."

**For STAR structure (identify which components are missing/weak):**
- Missing Situation: "Your answer jumps into action without context. Start with: 'In my previous role at [Company], we faced [specific problem] that was impacting [business metric].'"
- Missing Task: "Clarify what needed to be accomplished. State: 'I was tasked with [specific objective] within [constraints].'"
- Missing Action: "Detail what YOU specifically did. Use 'I' statements: 'I implemented [solution] by [method], I analyzed [data], I collaborated with [team] to [action].' Avoid 'we' - focus on your contributions."
- Missing Result: "End with measurable outcomes: 'This resulted in [specific metric], which [business impact].' Examples: reduced latency by 60%, increased conversion by 15%, saved $50K annually."
- Weak transitions: "Your STAR components are present but transitions are unclear. Use: 'The situation was...', 'My task was to...', 'To accomplish this, I...', 'The results were...'"

**For metrics & impact (check for numbers and business connection):**
- No metrics: "Your answer lacks quantifiable impact. Include: percentages (60% improvement), time (reduced from 2s to 0.5s), money (saved $50K), scale (handled 1M requests/day), or user impact (improved NPS from 40 to 65)."
- Vague metrics: "Be more specific. Instead of 'improved performance', say 'reduced page load time from 3.5s to 0.8s' or 'increased API throughput from 1K to 5K requests/second'."
- Missing business impact: "You have technical metrics but not business impact. Connect to outcomes: 'This reduced server costs by 30%' or 'increased user conversion by 22%'."

**For technical accuracy (evaluate correctness and depth):**
- Incorrect concepts: "Your explanation of [concept] is incorrect. [Correct explanation]. Review core concepts for [domain] before your next interview."
- Surface-level: "Your answer demonstrates basic understanding but lacks depth. Dive deeper: explain why you chose [technology], what trade-offs you considered, alternative approaches you evaluated, and how you validated the solution."
- Missing technical details: "Add more technical specifics. Instead of 'I optimized the database', say 'I optimized queries by adding composite indexes on [columns], which reduced query time from 500ms to 50ms for [use case]'."

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
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 1000,
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content in response');
      }

      // Log for debugging
      console.log('OpenAI response:', content);

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (parseError) {
        console.error('JSON parse error:', parseError, 'Content:', content);
        throw new Error(`Failed to parse JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
      }

      // Validate with schema
      const validated = EnhancedAnalysisResponseSchema.parse(parsed);
      return validated;
    } catch (error) {
      console.error(`Analysis attempt ${attempts + 1} failed:`, error);
      attempts++;
      
      if (attempts >= maxAttempts) {
        // Log the error for debugging
        console.error('All analysis attempts failed. Last error:', error);
        
        // Return more helpful fallback based on transcript length
        const hasContent = transcript.trim().length > 10;
        return {
          starScore: hasContent ? 2 : 1,
          impactScore: hasContent ? 2 : 1,
          clarityScore: hasContent ? 2 : 1,
          technicalAccuracy: hasContent ? 2 : 1,
          terminologyUsage: hasContent ? 2 : 1,
          tips: hasContent ? [
            'AI analysis temporarily unavailable',
            'Your response was recorded successfully',
            'Try speaking more clearly and structure your answer',
            'Use the STAR method: Situation, Task, Action, Result',
            'Include specific metrics and outcomes when possible',
          ] : [
            'Please provide a longer response',
            'Try speaking for at least 30 seconds',
            'Structure your answer with clear examples',
            'Include specific details and outcomes',
            'Practice speaking clearly and confidently',
          ],
        };
      }
      // Exponential backoff for retries
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
    }
  }

  throw new Error('Failed to analyze transcript after retries');
}
