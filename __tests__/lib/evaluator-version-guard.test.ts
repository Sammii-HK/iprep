import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildOptimizedSystemPrompt, buildOptimizedUserPrompt } from '@/lib/ai-optimized';
import { DEFAULT_PREFERENCES } from '@/lib/coaching-config';
import { SPOKEN_ANSWER_EVALUATOR } from '@/lib/attempts';

/**
 * Evaluations record which prompt and rubric version produced a score, so a change to the prompt must come with a
 * new version. This test pins the prompt text to the version label: edit the prompt and it fails until
 * SPOKEN_ANSWER_EVALUATOR.promptVersion (and rubricVersion, if the scoring bands changed) is bumped and a new
 * hash is added below next to it. Old versions stay in the table: they describe evaluations already recorded.
 */
const PINNED_PROMPTS: Record<string, string> = {
  'spoken-answer-prompt@1': '5b814b549c63ef5d1e587e4f5106f4a2d97eb318e0522c332cf83f4bfd90e058',
  // @2: adds the question-aware rubric section (lib/rubrics.ts); same scoring scale.
  'spoken-answer-prompt@2': '623633f124c8a8b5429f2b2faa83c3436704017cff94a900bd09641e757928aa',
};

function promptHash(): string {
  const system = buildOptimizedSystemPrompt(DEFAULT_PREFERENCES);
  const { prompt } = buildOptimizedUserPrompt(
    'I led a migration of three services.',
    'Tell me about a time you led a team.',
    'Use the STAR method.',
    ['leadership'],
    'BEHAVIORAL',
    { wordCount: 7, fillerCount: 0, fillerRate: 0, wpm: 120, longPauses: 0 },
    null
  );
  return createHash('sha256').update(system).update('\0').update(prompt).digest('hex');
}

describe('evaluator versions track the prompt they name', () => {
  it('the prompts match the hash pinned for the current promptVersion', () => {
    expect(PINNED_PROMPTS[SPOKEN_ANSWER_EVALUATOR.promptVersion]).toBe(promptHash());
  });
});
