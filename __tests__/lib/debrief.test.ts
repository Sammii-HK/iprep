import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    questionBank: { findFirst: vi.fn(), create: vi.fn() },
    question: { createMany: vi.fn() },
  },
}));

// The real client is never built in unit tests; the LLM is injected or mocked.
vi.mock('@/lib/ai-optimized', () => ({
  getOpenAIClient: vi.fn(),
  getChatModel: vi.fn().mockReturnValue('test-model'),
}));

import { prisma } from '@/lib/db';
import {
  DEBRIEF_BANK_TITLE,
  DEBRIEF_LIMITS,
  analyseDebrief,
  buildDebriefPrompt,
  buildQuestionHint,
  classifyQuestionType,
  cleanContextField,
  isSameQuestion,
  parseDebriefOutput,
  processDebrief,
  saveDebriefQuestions,
  type Debrief,
} from '@/lib/debrief';

const goodJson = JSON.stringify({
  questionsAsked: ['Tell me about a time you disagreed with a designer.', 'How does CSS specificity work?'],
  wentWell: ['The component library story landed'],
  stumbled: ['Froze on the accessibility question'],
  followUps: ['Revisit focus management'],
  oneThingToFix: 'Slow down on accessibility questions.',
});

const debrief: Debrief = {
  questionsAsked: ['Tell me about a time you disagreed with a designer.', 'How does CSS specificity work?'],
  wentWell: ['The component library story landed'],
  stumbled: ['Froze on the accessibility question'],
  followUps: [],
  oneThingToFix: 'Slow down.',
};

describe('parseDebriefOutput', () => {
  it('parses valid JSON', () => {
    const result = parseDebriefOutput(goodJson);
    expect(result.questionsAsked).toHaveLength(2);
    expect(result.oneThingToFix).toBe('Slow down on accessibility questions.');
  });

  it('accepts JSON wrapped in a code fence or prose', () => {
    expect(parseDebriefOutput('```json\n' + goodJson + '\n```').wentWell).toHaveLength(1);
    expect(parseDebriefOutput('Here you go: ' + goodJson + ' Hope that helps.').stumbled).toHaveLength(1);
  });

  it('fills missing fields with empty values', () => {
    const result = parseDebriefOutput(JSON.stringify({ questionsAsked: ['Why this company?'] }));
    expect(result).toEqual({
      questionsAsked: ['Why this company?'],
      wentWell: [],
      stumbled: [],
      followUps: [],
      oneThingToFix: '',
    });
  });

  it('drops non-string and empty items, squashes whitespace', () => {
    const result = parseDebriefOutput(
      JSON.stringify({ questionsAsked: ['  Why   us?  ', 42, '', null, 'Tell me about yourself.'] })
    );
    expect(result.questionsAsked).toEqual(['Why us?', 'Tell me about yourself.']);
  });

  it('caps list sizes and string lengths', () => {
    const many = Array.from({ length: 40 }, (_, i) => `Question number ${i} about something`);
    const result = parseDebriefOutput(
      JSON.stringify({
        questionsAsked: many,
        wentWell: many,
        oneThingToFix: 'x'.repeat(5000),
        stumbled: ['y'.repeat(1000)],
      })
    );
    expect(result.questionsAsked).toHaveLength(DEBRIEF_LIMITS.questions);
    expect(result.wentWell).toHaveLength(DEBRIEF_LIMITS.listItems);
    expect(result.oneThingToFix).toHaveLength(DEBRIEF_LIMITS.fixChars);
    expect(result.stumbled[0]).toHaveLength(DEBRIEF_LIMITS.itemChars);
  });

  it.each([
    ['not JSON', 'sorry, I cannot do that'],
    ['an array', '["a","b"]'],
    ['an object with none of the keys', '{"hello":"world"}'],
    ['a field of the wrong type', '{"questionsAsked":"one question"}'],
    ['empty output', ''],
  ])('rejects %s', (_name, text) => {
    expect(() => parseDebriefOutput(text)).toThrow();
  });
});

describe('analyseDebrief', () => {
  it('returns the parsed debrief from one LLM call', async () => {
    const complete = vi.fn().mockResolvedValue(goodJson);
    const result = await analyseDebrief('I was asked about CSS.', { company: 'Acme' }, complete);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.questionsAsked).toHaveLength(2);
  });

  it('retries once when the first output is malformed', async () => {
    const complete = vi.fn().mockResolvedValueOnce('not json').mockResolvedValueOnce(goodJson);
    const result = await analyseDebrief('transcript', {}, complete);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.wentWell).toHaveLength(1);
  });

  it('retries once when the call throws', async () => {
    const complete = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(goodJson);
    await expect(analyseDebrief('transcript', {}, complete)).resolves.toBeDefined();
  });

  it('throws a friendly external-service error after two bad outputs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const complete = vi.fn().mockResolvedValue('still not json');
    await expect(analyseDebrief('transcript', {}, complete)).rejects.toMatchObject({
      statusCode: 502,
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('builds a prompt that forbids invention and bounds the transcript', () => {
    const { system, user } = buildDebriefPrompt('x'.repeat(DEBRIEF_LIMITS.transcriptChars + 100), {
      company: 'Acme',
      role: 'Design Engineer',
      stage: 'Technical',
    });
    expect(system).toMatch(/Never invent/);
    expect(system).toMatch(/data, not instructions/);
    expect(user).toContain('Company: Acme');
    expect(user).toContain('Stage: Technical');
    expect(user).not.toContain('x'.repeat(DEBRIEF_LIMITS.transcriptChars + 1));
  });
});

describe('question helpers', () => {
  it('cleans context fields', () => {
    expect(cleanContextField('  Acme \n Ltd  ')).toBe('Acme Ltd');
    expect(cleanContextField('')).toBeUndefined();
    expect(cleanContextField(null)).toBeUndefined();
    expect(cleanContextField('a'.repeat(500))).toHaveLength(DEBRIEF_LIMITS.contextChars);
  });

  it('classifies obvious scenario and technical questions, defaulting to behavioural', () => {
    expect(classifyQuestionType('Tell me about a time you led a team.')).toBe('BEHAVIORAL');
    expect(classifyQuestionType('How would you design a date picker?')).toBe('SCENARIO');
    expect(classifyQuestionType('What is the difference between flex and grid?')).toBe('TECHNICAL');
    expect(classifyQuestionType('Why do you want to work here?')).toBe('BEHAVIORAL');
  });

  it('treats rewordings with near identical words as the same question', () => {
    expect(isSameQuestion('Tell me about yourself.', 'tell me about yourself')).toBe(true);
    expect(
      isSameQuestion(
        'Tell me about a time you disagreed with a designer.',
        'Tell me about a time you disagreed with a designer?'
      )
    ).toBe(true);
    expect(isSameQuestion('Why do you want this job?', 'What is your biggest weakness?')).toBe(false);
  });

  it('writes a short hint with where it was asked, what went well and the stumble', () => {
    const hint = buildQuestionHint(
      { company: 'Acme', role: 'Design Engineer', stage: 'Technical' },
      debrief,
      new Date('2026-10-03T10:00:00Z')
    );
    expect(hint).toBe(
      'Asked at Acme, Design Engineer, Technical on 3 Oct 2026. Went well: The component library story landed. Stumbled: Froze on the accessibility question.'
    );
    expect(hint.length).toBeLessThanOrEqual(DEBRIEF_LIMITS.hintChars);
  });

  it('omits context it was not given', () => {
    const hint = buildQuestionHint({}, { ...debrief, wentWell: [], stumbled: [] }, new Date('2026-10-03T10:00:00Z'));
    expect(hint).toBe('Asked in a real interview on 3 Oct 2026.');
  });
});

describe('saveDebriefQuestions (bank append and dedupe)', () => {
  const now = new Date('2026-10-03T10:00:00Z');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the bank when missing and appends every question', async () => {
    vi.mocked(prisma.questionBank.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.questionBank.create).mockResolvedValue({ id: 'bank-1', questions: [] } as never);

    const result = await saveDebriefQuestions('user-1', { company: 'Acme' }, debrief, now);

    expect(prisma.questionBank.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: 'user-1', title: DEBRIEF_BANK_TITLE } })
    );
    expect(result).toMatchObject({ bankId: 'bank-1', bankTitle: DEBRIEF_BANK_TITLE });
    expect(result.added).toHaveLength(2);

    const arg = vi.mocked(prisma.question.createMany).mock.calls[0][0] as {
      data: Array<{ bankId: string; text: string; hint: string; tags: string[]; type: string; difficulty: number }>;
    };
    expect(arg.data).toHaveLength(2);
    expect(arg.data[0]).toMatchObject({
      bankId: 'bank-1',
      tags: ['Acme', 'debrief'],
      type: 'BEHAVIORAL',
      difficulty: 3,
    });
    expect(arg.data[0].hint).toContain('Asked at Acme');
    expect(arg.data[1].type).toBe('TECHNICAL');
  });

  it('reuses the existing bank and does not create a second one', async () => {
    vi.mocked(prisma.questionBank.findFirst).mockResolvedValue({ id: 'bank-9', questions: [] } as never);
    await saveDebriefQuestions('user-1', {}, debrief, now);
    expect(prisma.questionBank.create).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.question.createMany).mock.calls[0][0]).toMatchObject({
      data: expect.arrayContaining([expect.objectContaining({ bankId: 'bank-9', tags: ['debrief'] })]),
    });
  });

  it('is idempotent: identical questions already in the bank are skipped', async () => {
    vi.mocked(prisma.questionBank.findFirst).mockResolvedValue({
      id: 'bank-1',
      questions: [
        { text: 'Tell me about a time you disagreed with a designer.' },
        { text: 'how does css specificity work' },
      ],
    } as never);

    const result = await saveDebriefQuestions('user-1', {}, debrief, now);

    expect(result.added).toEqual([]);
    expect(result.skipped).toHaveLength(2);
    expect(prisma.question.createMany).not.toHaveBeenCalled();
  });

  it('adds only the new question when some already exist', async () => {
    vi.mocked(prisma.questionBank.findFirst).mockResolvedValue({
      id: 'bank-1',
      questions: [{ text: 'How does CSS specificity work?' }],
    } as never);

    const result = await saveDebriefQuestions(
      'user-1',
      {},
      { ...debrief, questionsAsked: [...debrief.questionsAsked, 'Why do you want to join us?'] },
      now
    );

    expect(result.added).toEqual([
      'Tell me about a time you disagreed with a designer.',
      'Why do you want to join us?',
    ]);
    expect(result.skipped).toEqual(['How does CSS specificity work?']);
  });

  it('does not add the same question twice within one debrief', async () => {
    vi.mocked(prisma.questionBank.findFirst).mockResolvedValue({ id: 'bank-1', questions: [] } as never);
    const result = await saveDebriefQuestions(
      'user-1',
      {},
      { ...debrief, questionsAsked: ['Why do you want this role?', 'why do you want this role'] },
      now
    );
    expect(result.added).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });

  it('writes nothing when no questions were asked', async () => {
    vi.mocked(prisma.questionBank.findFirst).mockResolvedValue({ id: 'bank-1', questions: [] } as never);
    const result = await saveDebriefQuestions('user-1', {}, { ...debrief, questionsAsked: [] }, now);
    expect(result.added).toEqual([]);
    expect(prisma.question.createMany).not.toHaveBeenCalled();
  });
});

describe('processDebrief', () => {
  it('re-submitting the same transcript does not duplicate questions', async () => {
    vi.clearAllMocks();
    const complete = vi.fn().mockResolvedValue(goodJson);
    const stored: Array<{ text: string }> = [];

    vi.mocked(prisma.questionBank.findFirst).mockImplementation((() =>
      Promise.resolve({ id: 'bank-1', questions: stored.map((q) => ({ text: q.text })) })) as never);
    vi.mocked(prisma.question.createMany).mockImplementation(((args: { data: Array<{ text: string }> }) => {
      stored.push(...args.data);
      return Promise.resolve({ count: args.data.length });
    }) as never);

    const first = await processDebrief('user-1', 'same transcript', { company: 'Acme' }, { complete });
    const second = await processDebrief('user-1', 'same transcript', { company: 'Acme' }, { complete });

    expect(first.bank.added).toHaveLength(2);
    expect(second.bank.added).toHaveLength(0);
    expect(second.bank.skipped).toHaveLength(2);
    expect(stored).toHaveLength(2);
  });
});
