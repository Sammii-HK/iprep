import { describe, it, expect } from 'vitest';
import {
  checkClaims,
  extractMentions,
  parseWordNumber,
  CLAIMS_LABEL,
} from '@/lib/claims-check';
import { FACT_SHEET_FIXTURE } from '../fixtures/fact-sheet';

const flaggedOf = (answer: string, sheet: string = FACT_SHEET_FIXTURE) =>
  checkClaims(answer, sheet)?.items.flatMap((i) => i.flagged) ?? [];

describe('claims check: no fact sheet', () => {
  it('returns null so the response gains nothing extra', () => {
    expect(checkClaims('I cut load time by 60%.', null)).toBeNull();
    expect(checkClaims('I cut load time by 60%.', undefined)).toBeNull();
    expect(checkClaims('I cut load time by 60%.', '   ')).toBeNull();
  });
});

describe('claims check: supported vs unsupported', () => {
  it('does not flag figures that are in the record', () => {
    const result = checkClaims(
      'I built Orbit with 14 agents. A/B tests promote a winner past 80% confidence. It removed over 15 manual releases a year.',
      FACT_SHEET_FIXTURE
    );
    expect(result?.label).toBe(CLAIMS_LABEL);
    expect(result?.items).toEqual([]);
  });

  it('flags figures that are not in the record', () => {
    const result = checkClaims(
      'I cut the page load time by 60% and saved 50,000 pounds a year.',
      FACT_SHEET_FIXTURE
    );
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0].flagged).toEqual(expect.arrayContaining(['60%']));
    expect(result?.items[0].kinds).toEqual(expect.arrayContaining(['percentage', 'currency']));
  });

  it('flags a count whose noun does not match the record', () => {
    // The record has 14 agents, not 14 engineers.
    expect(flaggedOf('I managed 14 engineers.')).toEqual(['14']);
  });

  it('matches a count to its noun regardless of plural form', () => {
    expect(flaggedOf('There were fourteen agent runs every day.')).toEqual([]);
  });

  it('flags a percentage that is close to but not the recorded one', () => {
    expect(flaggedOf('Winners are promoted at 85% confidence.')).toEqual(['85%']);
  });

  it('flags one statement per sentence and reports each unsupported figure in it', () => {
    const result = checkClaims(
      'We shipped 12 releases. Then we shipped 90 more releases and saved 30%.',
      FACT_SHEET_FIXTURE
    );
    expect(result?.items).toHaveLength(2);
    expect(result?.items[1].flagged).toEqual(expect.arrayContaining(['90', '30%']));
  });

  it('flags strong claims that are absent and accepts those in the record', () => {
    expect(flaggedOf('I single-handedly doubled our signups.')).toEqual(
      expect.arrayContaining(['single-handedly', 'doubled'])
    );
    expect(flaggedOf('I built the design system from scratch.')).toEqual([]);
  });

  it('ignores years, months and tiny uncountable numbers', () => {
    expect(flaggedOf('In May 2022 I joined ASOS, and in 2024 I left.')).toEqual([]);
    expect(flaggedOf('Number one thing was the team. One of us led it.')).toEqual([]);
  });
});

describe('claims check: number formats', () => {
  const sheet = 'The campaign reached 1,000 customers and cost £2.5k.';

  it.each([
    ['1,000'],
    ['1000'],
    ['1k'],
    ['one thousand'],
    ['a thousand'],
  ])('treats %s as the same figure as the record', (form) => {
    expect(flaggedOf(`It reached ${form} customers.`, sheet)).toEqual([]);
  });

  it('normalises currency amounts across formats', () => {
    expect(flaggedOf('It cost £2,500.', sheet)).toEqual([]);
    expect(flaggedOf('It cost 2500 pounds.', sheet)).toEqual([]);
    expect(flaggedOf('It cost £3k.', sheet)).toEqual(['£3k']);
  });

  it('understands number words in the answer', () => {
    expect(flaggedOf('We had twenty five developers.', sheet)).toEqual(['twenty five']);
  });
});

describe('extractMentions / parseWordNumber', () => {
  it('parses number words', () => {
    expect(parseWordNumber('fourteen')).toBe(14);
    expect(parseWordNumber('twenty-five')).toBe(25);
    expect(parseWordNumber('two hundred')).toBe(200);
    expect(parseWordNumber('a thousand')).toBe(1000);
    expect(parseWordNumber('a dozen')).toBe(12);
  });

  it('classifies kinds', () => {
    const kinds = extractMentions('Saved 40% and £500 across 14 agents in 2 hours.').map(
      (m) => m.kind
    );
    expect(kinds).toEqual(['percentage', 'currency', 'count', 'number']);
  });
});
