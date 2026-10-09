import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    questionBank: { findUnique: vi.fn(), findMany: vi.fn() },
    session: { create: vi.fn() },
  },
}));
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
  requireAccess: vi.fn(async () => ({ user: { id: 'user-1', role: 'USER' } })),
}));

import { prisma } from '@/lib/db';
import { POST } from '@/app/api/sessions/route';

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as never);
const bank = (id: string, title = 'Bank', userId: string | null = 'user-1') => ({ id, title, userId, questions: [{ id: `${id}-q`, tags: [] }], _count: { questions: 3 } });
const A = 'cbanka00000000000000000a';
const B = 'cbankb00000000000000000b';

describe('POST /api/sessions with extraBankIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.questionBank.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(bank(A));
    (prisma.session.create as ReturnType<typeof vi.fn>).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 's1', createdAt: new Date(), ...data }));
  });

  it('stores the extra banks (deduped, never repeating the primary)', async () => {
    (prisma.questionBank.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([bank(B)]);
    const res = await post({ title: 'Mixed', bankId: A, extraBankIds: [B, B, A] });
    expect(res.status).toBe(200);
    expect((prisma.session.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.extraBankIds).toEqual([B]);
    expect((await res.json()).extraBankIds).toEqual([B]);
  });

  it('refuses an extra bank that is missing, someone else\'s, or the facts bank', async () => {
    for (const extras of [[], [bank(B, 'Other', 'user-2')], [bank(B, '__facts__')]]) {
      (prisma.questionBank.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(extras);
      const res = await post({ title: 'Mixed', bankId: A, extraBankIds: [B] });
      expect(res.status).toBe(404);
    }
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('single-bank creation is unchanged', async () => {
    const res = await post({ title: 'One', bankId: A });
    expect(res.status).toBe(200);
    expect((prisma.session.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.extraBankIds).toEqual([]);
    expect(prisma.questionBank.findMany).not.toHaveBeenCalled();
  });
});
