import OpenAI from 'openai';
import { z } from 'zod';

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
    } catch (error) {
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
  role: string = 'Senior Design Engineer / Design Engineering Leader',
  priorities: string[] = [
    'clarity',
    'impact statements',
    'resilience',
    'accessibility',
    'performance',
  ]
): Promise<EnhancedAnalysisResponse> {
  const systemPrompt = `You are an expert interview coach specializing in technical interviews.

Given a transcript and question context, return strict JSON with:
- starScore 0..5 (Situation, Task, Action, Result present & balanced)
- impactScore 0..5 (metrics, outcomes, 'so what')
- clarityScore 0..5 (structure, concision)
- technicalAccuracy 0..5 (technical correctness, use of appropriate concepts for the domain)
- terminologyUsage 0..5 (appropriate use of domain-specific terms based on question tags)
- tips: array of 5 short actionable tips (<= 20 words each):
  1. Content/structure tip
  2. Technical accuracy tip (specific to question domain)
  3. Delivery/confidence tip
  4. Specific improvement for this answer
  5. General speaking skill tip

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

  const userPrompt = `Transcript:
${transcript}

Context:
- Role: ${role}
- Priorities: ${priorities.join(', ')}
${domainContext}

Question Tags: ${questionTags.length > 0 ? questionTags.join(', ') : 'general (no specific domain)'}

Assess both speaking quality AND technical knowledge depth. Pay special attention to:
1. Technical accuracy - does the answer demonstrate correct understanding of concepts related to the question tags?
2. Terminology usage - does the answer use appropriate domain-specific terms?
3. Content quality - STAR structure, impact, and clarity

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
      return EnhancedAnalysisResponseSchema.parse(parsed);
    } catch (error) {
      attempts++;
      if (attempts >= maxAttempts) {
        // Fallback: return basic scores
        return {
          starScore: 2,
          impactScore: 2,
          clarityScore: 2,
          technicalAccuracy: 2,
          terminologyUsage: 2,
          tips: [
            'Could not analyze response',
            'Please try again',
            'Check your internet connection',
            'Ensure audio quality is good',
            'Speak clearly and at moderate pace',
          ],
        };
      }
      // Wait a bit before retry
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error('Failed to analyze transcript after retries');
}
