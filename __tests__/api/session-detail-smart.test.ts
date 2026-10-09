import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    session: { findUnique: vi.fn() },
    userQuestionProgress: { findMany: vi.fn() },
    interview: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock('@/lib/auth', () => {
  const requireAuth = vi.fn();
  return { requireAuth, requireAccess: vi.fn(async () => ({ user: { id: 'user-1', role: 'USER' } })) };
});

import { prisma } from '@/lib/db';
import { GET } from '@/app/api/sessions/[id]/route';

const day = (d: number) => new Date(Date.parse('2026-10-09T09:00:00Z') - d * 86_400_000);
const questions = [
  { id: 'q1', text: 'Explain closures in JavaScript', hint: 'h', tags: [], difficulty: 2, type: 'TECHNICAL' },
  { id: 'q2', text: 'What are your salary expectations?', hint: 'h', tags: [], difficulty: 1, type: 'BEHAVIORAL' },
  { id: 'q3', text: 'Explain React rendering behaviour', hint: 'h', tags: [], difficulty: 3, type: 'TECHNICAL' },
];
const session = (items: unknown[] = []) => ({
  id: 's1', userId: 'user-1', bankId: 'b1', createdAt: day(0), filterTags: [], isCompleted: false,
  bank: { id: 'b1', questions }, items,
});
const call = (qs: string) =>
  GET(new Request(`http://localhost/api/sessions/s1${qs}`) as never, { params: Promise.resolve({ id: 's1' }) });

describe('GET /api/sessions/[id] smart ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.interview.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('an upcoming interview raises relevant questions without removing others', async () => {
    (prisma.session.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(session());
    (prisma.userQuestionProgress.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.interview.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { company: 'Prismic', role: 'Senior Product Engineer', startsAt: new Date(Date.now() + 2 * 86_400_000), status: 'scheduled' },
    ]);
    const ids = (await (await call('?smart=1')).json()).questions.map((q: { id: string }) => q.id);
    expect(ids[0]).toBe('q3'); // 'rendering'/'react' matches the product-engineer profile
    expect(ids).toContain('q1');
  });

  it('default behaviour is unchanged: database order, nothing filtered', async () => {
    (prisma.session.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(session());
    const body = await (await call('')).json();
    expect(body.questions.map((q: { id: string }) => q.id)).toEqual(['q1', 'q2', 'q3']);
    expect(prisma.userQuestionProgress.findMany).not.toHaveBeenCalled();
  });

  it('smart=1 drops administrative questions and puts due ones first', async () => {
    (prisma.session.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(session());
    (prisma.userQuestionProgress.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { questionId: 'q3', nextReviewAt: day(2), lastPracticed: day(9), lastScore: 8, repetitions: 2 },
      { questionId: 'q1', nextReviewAt: day(-5), lastPracticed: day(0.1), lastScore: 8, repetitions: 2 },
    ]);
    const body = await (await call('?smart=1')).json();
    const ids = body.questions.map((q: { id: string }) => q.id);
    expect(ids).not.toContain('q2');
    expect(ids[0]).toBe('q3');
  });

  it('smart=1 keeps answered questions and respects maxQuestions', async () => {
    (prisma.session.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      session([{ id: 'i1', questionId: 'q3', createdAt: day(0), whatWasRight: [], whatWasWrong: [], betterWording: [], dontForget: [] }]),
    );
    (prisma.userQuestionProgress.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const body = await (await call('?smart=1&maxQuestions=2')).json();
    expect(body.questions).toHaveLength(2);
    expect(body.questions[0].id).toBe('q3');
  });
});
