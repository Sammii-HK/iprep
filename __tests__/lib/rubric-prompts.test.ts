import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildOptimizedSystemPrompt } from '@/lib/ai-optimized';
import { DEFAULT_PREFERENCES } from '@/lib/coaching-config';

const promptsDir = join(process.cwd(), 'lib', 'prompts');
const read = (name: string) => readFileSync(join(promptsDir, name), 'utf8');

describe('specificity rubric (system prompt)', () => {
  const prompt = buildOptimizedSystemPrompt(DEFAULT_PREFERENCES);

  it('scores impact as specificity and never requires numbers', () => {
    expect(prompt).toMatch(/SPECIFICITY/);
    expect(prompt).toMatch(/Never mark an answer down for lacking figures/);
  });

  it('forbids better-wording suggestions from adding figures, names or claims', () => {
    expect(prompt).toMatch(/NEVER add figures/);
    expect(prompt).toMatch(/not already in the candidate's answer or in their fact sheet/);
  });

  it('no longer rewards metrics', () => {
    expect(prompt).not.toMatch(/Multiple specific metrics/i);
    expect(prompt).not.toMatch(/some metrics/i);
    expect(prompt).not.toMatch(/strong metrics/i);
    expect(prompt).not.toMatch(/reducing deploy time by 70%/);
  });
});

describe('prompt reference docs', () => {
  const files = [
    'coaching-context.md',
    'examples.md',
    'feedback-templates.md',
    'industry-knowledge.md',
  ];

  it.each(files)('%s has no metrics-reward wording', (file) => {
    const text = read(file);
    expect(text).not.toMatch(/quantifiable/i);
    expect(text).not.toMatch(/Multiple specific metrics/i);
    expect(text).not.toMatch(/\bNo Metrics\b/);
    expect(text).not.toMatch(/\$50K/);
  });

  it('coaching context defines the specificity score and honesty rules', () => {
    const text = read('coaching-context.md');
    expect(text).toMatch(/specificity/i);
    expect(text).toMatch(/Numbers are welcome only if they are true/);
    expect(text).toMatch(/must never add figures/);
  });
});
