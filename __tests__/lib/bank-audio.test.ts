import { describe, it, expect } from 'vitest';
import {
  buildEpisodeScript,
  chunkText,
  decideEpisodeAction,
  episodeSourceHash,
  estimateCost,
  spokenTitle,
  type EpisodeMeta,
} from '@/lib/bank-audio';

const questions = [
  { text: 'Walk me through a failure.', hint: 'Answer with Orbit: 14 agents across 21 scheduled jobs.' },
  { text: 'How do you measure quality?', hint: null },
];

describe('buildEpisodeScript', () => {
  it('reads question text and hints exactly as stored', () => {
    const script = buildEpisodeScript('My bank', questions);
    const spoken = script.segments.flatMap((s) => (s.kind === 'speech' ? [s.text] : []));
    expect(spoken).toContain('Walk me through a failure.');
    expect(spoken).toContain('Answer with Orbit: 14 agents across 21 scheduled jobs.');
  });

  it('does not invent answer notes when a hint is missing', () => {
    const script = buildEpisodeScript('My bank', questions);
    expect(script.transcript).toContain('There are no answer notes for this one.');
    expect(script.transcript.match(/Answer notes\./g)).toHaveLength(1);
  });

  it('never adds em or en dashes in its own framing', () => {
    const script = buildEpisodeScript('Role — Senior/Staff', questions);
    expect(script.transcript).not.toMatch(/[–—]/);
    expect(script.transcript).toContain('Senior or Staff');
  });

  it('counts only spoken characters', () => {
    const script = buildEpisodeScript('B', questions);
    const spoken = script.segments.reduce((n, s) => (s.kind === 'speech' ? n + s.text.length : n), 0);
    expect(script.characters).toBe(spoken);
  });

  it('puts a thinking pause after each question', () => {
    const script = buildEpisodeScript('B', questions, { pauseSeconds: 7 });
    expect(script.segments.some((s) => s.kind === 'pause' && s.seconds === 7)).toBe(true);
  });
});

describe('chunkText', () => {
  it('keeps short text as one chunk', () => {
    expect(chunkText('Hello there.')).toEqual(['Hello there.']);
  });

  it('splits long text on sentence boundaries within the limit and loses no words', () => {
    const sentence = 'This is a reasonably long sentence about design systems. ';
    const text = sentence.repeat(60).trim();
    const chunks = chunkText(text, 300);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 300)).toBe(true);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });

  it('splits a single oversized sentence on spaces', () => {
    const text = 'word '.repeat(100).trim();
    const chunks = chunkText(text, 50);
    expect(chunks.every((c) => c.length <= 50)).toBe(true);
  });
});

describe('estimateCost', () => {
  it('prices Kokoro at about 0.62 USD per million characters', () => {
    expect(estimateCost(1_000_000).usd).toBeCloseTo(0.62, 5);
    expect(estimateCost(0).pence).toBe(0);
  });
});

describe('episode hash and decisions', () => {
  const script = buildEpisodeScript('B', questions);
  const hash = episodeSourceHash(script);
  const meta = (sourceHash: string): EpisodeMeta => ({
    sourceHash,
    voice: 'bf_emma',
    model: 'm',
    characters: 1,
    questionCount: 2,
    generatedAt: '2026-10-06T00:00:00Z',
  });

  it('is stable for identical content and changes when a hint changes', () => {
    expect(episodeSourceHash(buildEpisodeScript('B', questions))).toBe(hash);
    const edited = [{ ...questions[0], hint: 'Changed.' }, questions[1]];
    expect(episodeSourceHash(buildEpisodeScript('B', edited))).not.toBe(hash);
  });

  it('changes when the voice changes', () => {
    expect(episodeSourceHash(script, 'bf_isabella')).not.toBe(hash);
  });

  it('generates when no audio exists', () => {
    expect(decideEpisodeAction({ hasAudio: false, meta: null }, hash)).toBe('generate');
  });

  it('skips when the stored hash matches', () => {
    expect(decideEpisodeAction({ hasAudio: true, meta: meta(hash) }, hash)).toBe('skip-up-to-date');
  });

  it('regenerates only when the questions changed', () => {
    expect(decideEpisodeAction({ hasAudio: true, meta: meta('old') }, hash)).toBe('regenerate');
  });

  it('leaves episodes made by other tools alone unless forced', () => {
    expect(decideEpisodeAction({ hasAudio: true, meta: null }, hash)).toBe('skip-unmanaged');
    expect(decideEpisodeAction({ hasAudio: true, meta: null }, hash, true)).toBe('regenerate');
  });
});

describe('spokenTitle', () => {
  it('replaces slashes and dashes for speech', () => {
    expect(spokenTitle('Design Engineer, Product (Senior/Staff)')).toBe('Design Engineer, Product (Senior or Staff)');
  });
});
