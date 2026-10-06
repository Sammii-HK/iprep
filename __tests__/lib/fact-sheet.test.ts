import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    questionBank: {
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    question: {
      update: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '@/lib/db';
import {
  FACTS_BANK_TITLE,
  FACT_SHEET_MAX_CHARS,
  getFactSheet,
  isFactsBankTitle,
  normaliseFactSheet,
  notFactsBank,
  setFactSheet,
} from '@/lib/fact-sheet';

describe('fact sheet helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the exact reserved title and a Prisma exclusion fragment', () => {
    expect(FACTS_BANK_TITLE).toBe('__facts__');
    expect(isFactsBankTitle('__facts__')).toBe(true);
    expect(isFactsBankTitle('__Facts__')).toBe(false);
    expect(isFactsBankTitle('My bank')).toBe(false);
    expect(notFactsBank).toEqual({ title: { not: '__facts__' } });
  });

  it('normalises line endings, trims and caps length', () => {
    expect(normaliseFactSheet('  a\r\nb  ')).toBe('a\nb');
    expect(normaliseFactSheet('x'.repeat(FACT_SHEET_MAX_CHARS + 10))).toHaveLength(FACT_SHEET_MAX_CHARS);
  });

  describe('getFactSheet', () => {
    it('reads the hint of the user\'s __facts__ bank', async () => {
      vi.mocked(prisma.questionBank.findFirst).mockResolvedValue({
        questions: [{ hint: '  Built Orbit.  ' }],
      } as never);

      await expect(getFactSheet('user-1')).resolves.toBe('Built Orbit.');
      expect(prisma.questionBank.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', title: '__facts__' } })
      );
    });

    it('returns null when there is no bank, no question or an empty hint', async () => {
      vi.mocked(prisma.questionBank.findFirst).mockResolvedValueOnce(null);
      await expect(getFactSheet('user-1')).resolves.toBeNull();

      vi.mocked(prisma.questionBank.findFirst).mockResolvedValueOnce({ questions: [] } as never);
      await expect(getFactSheet('user-1')).resolves.toBeNull();

      vi.mocked(prisma.questionBank.findFirst).mockResolvedValueOnce({
        questions: [{ hint: '   ' }],
      } as never);
      await expect(getFactSheet('user-1')).resolves.toBeNull();
    });
  });

  describe('setFactSheet', () => {
    it('creates the bank with a single question when none exists', async () => {
      vi.mocked(prisma.questionBank.findFirst).mockResolvedValue(null);

      await expect(setFactSheet('user-1', ' My record ')).resolves.toBe('My record');

      const arg = vi.mocked(prisma.questionBank.create).mock.calls[0][0] as {
        data: { userId: string; title: string; questions: { create: { hint: string } } };
      };
      expect(arg.data.userId).toBe('user-1');
      expect(arg.data.title).toBe('__facts__');
      expect(arg.data.questions.create.hint).toBe('My record');
    });

    it('updates the existing question rather than creating a second bank', async () => {
      vi.mocked(prisma.questionBank.findFirst).mockResolvedValue({
        id: 'bank-1',
        questions: [{ id: 'q-1' }],
      } as never);

      await setFactSheet('user-1', 'New record');

      expect(prisma.questionBank.create).not.toHaveBeenCalled();
      expect(prisma.question.update).toHaveBeenCalledWith({
        where: { id: 'q-1' },
        data: { hint: 'New record' },
      });
    });

    it('adds the question if the bank exists without one', async () => {
      vi.mocked(prisma.questionBank.findFirst).mockResolvedValue({
        id: 'bank-1',
        questions: [],
      } as never);

      await setFactSheet('user-1', 'Record');

      expect(prisma.question.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ bankId: 'bank-1', hint: 'Record' }) })
      );
    });

    it('clears the sheet when given empty text', async () => {
      vi.mocked(prisma.questionBank.findFirst).mockResolvedValue({
        id: 'bank-1',
        questions: [{ id: 'q-1' }],
      } as never);

      await expect(setFactSheet('user-1', '   ')).resolves.toBeNull();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.question.deleteMany).toHaveBeenCalledWith({ where: { bankId: 'bank-1' } });
      expect(prisma.questionBank.delete).toHaveBeenCalledWith({ where: { id: 'bank-1' } });
    });

    it('does nothing when clearing a sheet that does not exist', async () => {
      vi.mocked(prisma.questionBank.findFirst).mockResolvedValue(null);
      await expect(setFactSheet('user-1', '')).resolves.toBeNull();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
