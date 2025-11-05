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

Given a transcript, return strict JSON with:
- starScore 0..5 (Situation, Task, Action, Result present & balanced)
- impactScore 0..5 (metrics, outcomes, 'so what')
- clarityScore 0..5 (structure, concision)
- technicalAccuracy 0..5 (technical correctness, use of appropriate concepts)
- terminologyUsage 0..5 (appropriate use of domain-specific terms)
- tips: array of 5 short actionable tips (<= 20 words each):
  1. Content/structure tip
  2. Technical accuracy tip
  3. Delivery/confidence tip
  4. Specific improvement for this answer
  5. General speaking skill tip

Return JSON only, no markdown, no explanation.`;

  const userPrompt = `Transcript:
${transcript}

Context:
- Role: ${role}
- Priorities: ${priorities.join(', ')}
- Question Tags: ${questionTags.join(', ') || 'general'}

Assess both speaking quality and technical knowledge depth.

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
