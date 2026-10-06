import { describe, it, expect } from 'vitest';
import {
  SOURCE_RULES,
  buildDialogueSource,
  checkDialogueTranscript,
  decideBankAction,
  dialogueSourceHash,
  estimateDialogueCost,
  findBannedNames,
  findUnsupportedNumbers,
} from '@/lib/bank-audio';

const notes = 'Question 1: Tell me about Orbit.\nAnswer notes: 14 agents across 21 scheduled jobs, about 96% drop, 3,000 URLs.';

describe('host name and brand ban', () => {
  it('fails on Luna or Sol as names', () => {
    expect(findBannedNames('Luna: hello. Sol: hi.', notes).sort()).toEqual(['Luna', 'Sol']);
    expect(findBannedNames('Welcome back, I am Sol.', notes)).toEqual(['Sol']);
  });

  it('does not trip on words that merely contain the names', () => {
    expect(findBannedNames('A solid solution, lunar cycles, Lunatic fringe.', notes)).toEqual([]);
  });

  it('fails on The Grimoire or Lunary branding the notes never use', () => {
    expect(findBannedNames('Welcome to The Grimoire podcast, from Lunary.', notes).sort()).toEqual(['Lunary', 'The Grimoire']);
  });

  it('allows Lunary when the notes themselves talk about it', () => {
    expect(findBannedNames('She built Lunary herself.', 'Answer notes: Lunary has 3,000 URLs')).toEqual([]);
  });

  it('the prompt itself forbids the names and brands', () => {
    expect(SOURCE_RULES).toMatch(/Never use the names Luna or Sol/);
    expect(SOURCE_RULES).toMatch(/never mention The Grimoire/);
    expect(SOURCE_RULES).toMatch(/Jess and Zac/);
  });
});

describe('number guard', () => {
  it('passes numbers that are in the notes, in any formatting of commas', () => {
    expect(findUnsupportedNumbers('Fourteen is 14, 21 jobs, 3000 URLs, 96% down.', notes, 1)).toEqual([]);
  });

  it('flags invented figures', () => {
    expect(findUnsupportedNumbers('She saved 40% and led 12 engineers in 2019.', notes, 1)).toEqual(['12', '40', '2019']);
  });

  it('allows question numbers up to the question count only', () => {
    expect(findUnsupportedNumbers('Question 1. Then question 2.', notes, 1)).toEqual(['2']);
    expect(findUnsupportedNumbers('Question 1. Then question 2.', notes, 2)).toEqual([]);
  });

  it('ignores sentence-ending full stops after numbers', () => {
    expect(findUnsupportedNumbers('That was 14.', notes, 1)).toEqual([]);
  });
});

describe('checkDialogueTranscript', () => {
  it('is ok for a clean transcript', () => {
    const r = checkDialogueTranscript('Jess: 14 agents. Zac: nice.', notes, 1);
    expect(r.ok).toBe(true);
  });

  it('fails the bank on either problem and reports both', () => {
    const r = checkDialogueTranscript('Luna: she hit 77% growth.', notes, 1);
    expect(r.ok).toBe(false);
    expect(r.bannedNames).toEqual(['Luna']);
    expect(r.unsupportedNumbers).toEqual(['77']);
  });

  it('flags em dashes without failing', () => {
    const r = checkDialogueTranscript('Jess: yes — exactly.', notes, 1);
    expect(r.hasDashes).toBe(true);
    expect(r.ok).toBe(true);
  });
});

describe('dialogue cost and hash', () => {
  it('prices 10 minutes at Orpheus $7 per 1M chars on 9,000 chars plus the LLM allowance', () => {
    const e = estimateDialogueCost(10);
    expect(e.characters).toBe(9000);
    expect(e.usd).toBeCloseTo(0.063 + 0.01, 5);
  });

  it('prepends the source rules to the notes', () => {
    const { source, notes: n } = buildDialogueSource([{ text: 'Q?', hint: 'A.' }]);
    expect(source.startsWith(SOURCE_RULES)).toBe(true);
    expect(n).toBe('Question 1: Q?\nAnswer notes: A.');
  });

  it('keys the hash by content and length, and differs from the narrator hash space', () => {
    const a = buildDialogueSource([{ text: 'Q?', hint: 'A.' }]).source;
    const b = buildDialogueSource([{ text: 'Q?', hint: 'B.' }]).source;
    expect(dialogueSourceHash(a, 10)).toBe(dialogueSourceHash(a, 10));
    expect(dialogueSourceHash(a, 10)).not.toBe(dialogueSourceHash(b, 10));
    expect(dialogueSourceHash(a, 10)).not.toBe(dialogueSourceHash(a, 12));
  });
});

describe('decideBankAction (local first)', () => {
  const none = { hasAudio: false, meta: null };
  const base = { remote: none, hash: 'h', force: false };

  it('generates when nothing exists', () => {
    expect(decideBankAction({ ...base, local: null, upload: false })).toBe('generate');
  });

  it('never regenerates a matching local render, and uploads it only with --upload', () => {
    const local = { sourceHash: 'h', status: 'ok' as const };
    expect(decideBankAction({ ...base, local, upload: false })).toBe('skip-local-ready');
    expect(decideBankAction({ ...base, local, upload: true })).toBe('upload-local');
  });

  it('never uploads a needs-review bank, even with --upload', () => {
    const local = { sourceHash: 'h', status: 'needs-review' as const };
    expect(decideBankAction({ ...base, local, upload: true })).toBe('skip-needs-review');
  });

  it('skips when R2 already has this exact style and content', () => {
    const remote = { hasAudio: true, meta: { sourceHash: 'h' } };
    expect(decideBankAction({ ...base, remote, local: null, upload: true })).toBe('skip-up-to-date');
  });

  it('regenerates when a different style or content is in R2, and when the local render is stale', () => {
    const remote = { hasAudio: true, meta: { sourceHash: 'narrator-hash' } };
    expect(decideBankAction({ ...base, remote, local: null, upload: false })).toBe('regenerate');
    expect(decideBankAction({ ...base, local: { sourceHash: 'old', status: 'ok' }, upload: false })).toBe('generate');
  });
});
