import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

vi.mock('@/lib/db', () => ({
  prisma: {
    questionBank: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    bankFolder: { findMany: vi.fn() },
    session: { create: vi.fn() },
    quiz: { create: vi.fn() },
    userQuestionProgress: { findMany: vi.fn(), count: vi.fn() },
    question: { count: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => {
  const requireAuth = vi.fn();
  // Routes that accept machine principals call requireAccess; in these tests it resolves to the signed-in user.
  return { requireAuth, requireAccess: vi.fn(async (...args: unknown[]) => ({ user: await (requireAuth as (...a: unknown[]) => unknown)(...args) })) };
});

import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { GET as getBanks, POST as postBank } from '@/app/api/banks/route';
import { GET as getBank, PATCH as patchBank, DELETE as deleteBank } from '@/app/api/banks/[id]/route';
import { GET as getFolders } from '@/app/api/folders/route';
import { POST as postSession } from '@/app/api/sessions/route';
import { POST as postQuiz } from '@/app/api/quizzes/route';
import { getReviewQueue, getDailyQuota } from '@/lib/study-tracker';

const notFacts = { title: { not: '__facts__' } };

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  role: 'USER',
  isPremium: false,
  emailVerified: true,
  createdAt: new Date(),
};

const factsBank = {
  id: 'cfactsbankaaaaaaaaaaaaaa',
  userId: 'user-1',
  title: '__facts__',
  questions: [{ id: 'q1', text: 'Fact sheet', hint: 'secret record' }],
};

function req(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

function json(body: unknown, method = 'POST'): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

describe('__facts__ bank exclusion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(mockUser);
    vi.mocked(prisma.questionBank.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.bankFolder.findMany).mockResolvedValue([] as never);
  });

  describe('listings', () => {
    it('GET /api/banks (plain) filters the facts bank', async () => {
      await getBanks(new NextRequest('http://localhost/api/banks'));
      const arg = vi.mocked(prisma.questionBank.findMany).mock.calls[0][0] as { where: object };
      expect(arg.where).toEqual({ userId: 'user-1', ...notFacts });
    });

    it('GET /api/banks?includeFolders filters banks and folder items', async () => {
      await getBanks(new NextRequest('http://localhost/api/banks?includeFolders=true'));
      const bankArg = vi.mocked(prisma.questionBank.findMany).mock.calls[0][0] as { where: object };
      expect(bankArg.where).toEqual({ userId: 'user-1', ...notFacts });
      const folderArg = vi.mocked(prisma.bankFolder.findMany).mock.calls[0][0] as {
        include: { items: { where: object } };
      };
      expect(folderArg.include.items.where).toEqual({ bank: notFacts });
    });

    it('GET /api/folders filters folder items', async () => {
      await getFolders(req('http://localhost/api/folders') as never);
      const arg = vi.mocked(prisma.bankFolder.findMany).mock.calls[0][0] as {
        include: { items: { where: object } };
      };
      expect(arg.include.items.where).toEqual({ bank: notFacts });
    });
  });

  describe('direct access and creation', () => {
    it('GET /api/banks/[id] returns 404 for the facts bank and never leaks the sheet', async () => {
      vi.mocked(prisma.questionBank.findUnique).mockResolvedValue(factsBank as never);
      const res = await getBank(req('http://localhost/api/banks/x') as never, {
        params: Promise.resolve({ id: factsBank.id }),
      });
      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain('secret record');
    });

    it('PATCH and DELETE /api/banks/[id] treat the facts bank as missing', async () => {
      vi.mocked(prisma.questionBank.findUnique).mockResolvedValue(factsBank as never);
      const patch = await patchBank(
        req('http://localhost/api/banks/x', json({ title: 'Renamed' }, 'PATCH')) as never,
        { params: Promise.resolve({ id: factsBank.id }) }
      );
      const del = await deleteBank(req('http://localhost/api/banks/x', { method: 'DELETE' }) as never, {
        params: Promise.resolve({ id: factsBank.id }),
      });
      expect(patch.status).toBe(404);
      expect(del.status).toBe(404);
    });

    it('rejects renaming an ordinary bank to the reserved title', async () => {
      vi.mocked(prisma.questionBank.findUnique).mockResolvedValue({
        id: 'cbankaaaaaaaaaaaaaaaaaaa',
        userId: 'user-1',
        title: 'Mine',
      } as never);
      const res = await patchBank(
        req('http://localhost/api/banks/x', json({ title: '__facts__' }, 'PATCH')) as never,
        { params: Promise.resolve({ id: 'cbankaaaaaaaaaaaaaaaaaaa' }) }
      );
      expect(res.status).toBe(400);
    });

    it('POST /api/banks rejects the reserved title', async () => {
      const res = await postBank(
        req('http://localhost/api/banks', json({ title: '__facts__', questions: [{ text: 'q', hint: 'h' }] })) as never
      );
      expect(res.status).toBe(400);
      expect(prisma.questionBank.create).not.toHaveBeenCalled();
    });
  });

  describe('practice and quiz pickers', () => {
    it('POST /api/sessions cannot start a session on the facts bank', async () => {
      vi.mocked(prisma.questionBank.findUnique).mockResolvedValue(factsBank as never);
      const res = await postSession(
        req('http://localhost/api/sessions', json({ title: 'Practice', bankId: factsBank.id })) as never
      );
      expect(res.status).toBe(404);
      expect(prisma.session.create).not.toHaveBeenCalled();
    });

    it('POST /api/quizzes cannot build a quiz from the facts bank', async () => {
      vi.mocked(prisma.questionBank.findUnique).mockResolvedValue(factsBank as never);
      const res = await postQuiz(
        req(
          'http://localhost/api/quizzes',
          json({ title: 'Quiz', type: 'SPOKEN', bankId: factsBank.id })
        ) as never
      );
      expect(res.status).toBe(404);
      expect(prisma.quiz.create).not.toHaveBeenCalled();
    });
  });

  describe('review queue and quota', () => {
    it('getReviewQueue excludes questions from the facts bank', async () => {
      vi.mocked(prisma.userQuestionProgress.findMany).mockResolvedValue([] as never);
      await getReviewQueue('user-1', 10);
      const arg = vi.mocked(prisma.userQuestionProgress.findMany).mock.calls[0][0] as {
        where: { question: { bank: object } };
      };
      expect(arg.where.question).toEqual({ bank: notFacts });
    });

    it('getDailyQuota does not count the facts question as unpractised', async () => {
      vi.mocked(prisma.userQuestionProgress.count).mockResolvedValue(0 as never);
      vi.mocked(prisma.question.count).mockResolvedValue(0 as never);
      const future = new Date(Date.now() + 5 * 86400000);
      await getDailyQuota('user-1', future);
      const arg = vi.mocked(prisma.question.count).mock.calls[0][0] as {
        where: { bank: object };
      };
      expect(arg.where.bank).toEqual({ userId: 'user-1', ...notFacts });
    });
  });
});

/**
 * Regression guard: any route or lib that lists banks or folder items must
 * reference the facts exclusion. New listings that forget it fail here.
 */
describe('listing queries all reference the facts exclusion', () => {
  const root = process.cwd();
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name)) files.push(full);
    }
  };
  walk(join(root, 'app', 'api'));
  walk(join(root, 'lib'));

  // Files that legitimately query banks without a user-facing listing.
  const allowed = new Set([
    join(root, 'lib', 'fact-sheet.ts'), // owns the storage
    join(root, 'app', 'api', 'health', 'route.ts'), // db ping count
  ]);

  const listing = /questionBank\.findMany|bankFolder\.findMany|userQuestionProgress\.findMany|prisma\.question\.count|questionBank\.count/;

  it('every listing file references the exclusion', () => {
    const offenders = files
      .filter((f) => !allowed.has(f))
      .filter((f) => listing.test(readFileSync(f, 'utf8')))
      .filter((f) => !/notFactsBank|isFactsBankTitle/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.replace(root, ''))).toEqual([]);
  });
});
