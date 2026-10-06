import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/db', () => ({
  prisma: {
    interview: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    bankFolder: { findFirst: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { GET, POST } from '@/app/api/interviews/route';
import { PATCH, DELETE } from '@/app/api/interviews/[id]/route';
import { POST as SYNC } from '@/app/api/interviews/sync/route';
import { GET as NEXT } from '@/app/api/interviews/next/route';

const user = { id: 'user-1', email: 'a@b.c', name: null, role: 'USER', isPremium: false, emailVerified: true, createdAt: new Date() };
const db = vi.mocked(prisma, true);

function req(method: string, body?: unknown, url = 'http://localhost:3000/api/interviews') {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}
const valid = { company: 'Attio', role: 'Engineer', startsAt: '2099-10-10T10:00:00+01:00' };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const inDays = (d: number) => new Date(Date.now() + d * 86400000);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(user);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
});

describe('POST /api/interviews', () => {
  it('requires authentication', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
    expect((await POST(req('POST', valid))).status).toBe(401);
  });

  it('is rate limited', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    expect((await POST(req('POST', valid))).status).toBe(429);
  });

  it('returns 400 for invalid JSON and invalid bodies', async () => {
    expect((await POST(req('POST', '{nope'))).status).toBe(400);
    expect((await POST(req('POST', { ...valid, company: '' }))).status).toBe(400);
    expect((await POST(req('POST', { ...valid, link: 'javascript:alert(1)' }))).status).toBe(400);
    expect(db.interview.create).not.toHaveBeenCalled();
  });

  it('rejects a folder that is not the user\'s', async () => {
    db.bankFolder.findFirst.mockResolvedValue(null);
    expect((await POST(req('POST', { ...valid, folderId: 'someone-elses' }))).status).toBe(400);
  });

  it('creates a manual interview owned by the user', async () => {
    db.interview.create.mockResolvedValue({ id: 'i1' } as never);
    const res = await POST(req('POST', valid));
    expect(res.status).toBe(201);
    const arg = db.interview.create.mock.calls[0][0].data;
    expect(arg).toMatchObject({ userId: 'user-1', source: 'manual', company: 'Attio' });
    expect(arg.startsAt).toBeInstanceOf(Date);
  });
});

describe('GET /api/interviews', () => {
  const rows = [
    { id: 'past', startsAt: inDays(-5), endsAt: null, status: 'scheduled' },
    { id: 'cancelled', startsAt: inDays(2), endsAt: null, status: 'cancelled' },
    { id: 'soon', startsAt: inDays(1), endsAt: null, status: 'scheduled' },
  ];

  it('returns upcoming, non-cancelled interviews by default', async () => {
    db.interview.findMany.mockResolvedValue(rows as never);
    const body = await (await GET(new NextRequest('http://localhost:3000/api/interviews'))).json();
    expect(body.interviews.map((i: { id: string }) => i.id)).toEqual(['soon']);
  });

  it('includes past and cancelled with includePast=true', async () => {
    db.interview.findMany.mockResolvedValue(rows as never);
    const body = await (await GET(new NextRequest('http://localhost:3000/api/interviews?includePast=true'))).json();
    expect(body.interviews.map((i: { id: string }) => i.id)).toEqual(['soon', 'cancelled', 'past']);
  });
});

describe('PATCH and DELETE /api/interviews/[id]', () => {
  it('404s for an interview that is not the user\'s', async () => {
    db.interview.findFirst.mockResolvedValue(null);
    expect((await PATCH(req('PATCH', { status: 'completed' }), params('x'))).status).toBe(404);
    expect((await DELETE(req('DELETE'), params('x'))).status).toBe(404);
    expect(db.interview.findFirst).toHaveBeenCalledWith({ where: { id: 'x', userId: 'user-1' } });
  });

  it('validates the patch body before touching the database', async () => {
    expect((await PATCH(req('PATCH', { status: 'maybe' }), params('x'))).status).toBe(400);
    expect(db.interview.update).not.toHaveBeenCalled();
  });

  it('updates and deletes owned interviews', async () => {
    db.interview.findFirst.mockResolvedValue({ id: 'i1' } as never);
    db.interview.update.mockResolvedValue({ id: 'i1', status: 'completed' } as never);
    expect((await PATCH(req('PATCH', { status: 'completed' }), params('i1'))).status).toBe(200);
    expect((await DELETE(req('DELETE'), params('i1'))).status).toBe(200);
    expect(db.interview.delete).toHaveBeenCalledWith({ where: { id: 'i1' } });
  });
});

describe('POST /api/interviews/sync', () => {
  const item = { ...valid, externalId: 'notion-1' };

  it('requires authentication (internal key resolves via requireAuth)', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
    expect((await SYNC(req('POST', { interviews: [item] }))).status).toBe(401);
  });

  it('validates the payload', async () => {
    expect((await SYNC(req('POST', { interviews: [valid] }))).status).toBe(400);
    expect((await SYNC(req('POST', { source: 'manual', interviews: [] }))).status).toBe(400);
  });

  it('upserts and reports counts', async () => {
    db.interview.findMany.mockResolvedValue([] as never);
    db.$transaction.mockResolvedValue([] as never);
    const res = await SYNC(req('POST', { interviews: [item] }));
    expect(await res.json()).toEqual({ created: 1, updated: 0, cancelled: 0 });
    expect(db.interview.create.mock.calls[0][0].data).toMatchObject({ userId: 'user-1', source: 'notion', externalId: 'notion-1' });
  });

  it('cancels missing interviews only when complete is true', async () => {
    const stored = [{ id: 'old', externalId: 'gone', status: 'scheduled', startsAt: inDays(3) }];
    db.interview.findMany.mockResolvedValue(stored as never);
    db.$transaction.mockResolvedValue([] as never);

    expect(await (await SYNC(req('POST', { interviews: [item] }))).json()).toMatchObject({ cancelled: 0 });
    expect(await (await SYNC(req('POST', { complete: true, interviews: [item] }))).json()).toMatchObject({ cancelled: 1 });
    expect(db.interview.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['old'] }, userId: 'user-1' },
      data: { status: 'cancelled' },
    });
  });
});

describe('GET /api/interviews/next', () => {
  it('returns nulls when nothing is upcoming', async () => {
    db.interview.findMany.mockResolvedValue([] as never);
    expect(await (await NEXT(req('GET'))).json()).toEqual({ interview: null, folder: null });
  });

  it('picks the soonest and resolves its folder and banks via folderId', async () => {
    db.interview.findMany.mockResolvedValue([
      { id: 'later', company: 'B', folderId: null, startsAt: inDays(5), endsAt: null, status: 'scheduled' },
      { id: 'soon', company: 'Attio', folderId: 'f2', startsAt: inDays(1), endsAt: null, status: 'scheduled' },
    ] as never);
    db.bankFolder.findMany.mockResolvedValue([
      { id: 'f1', title: 'Attio Interview Prep', items: [] },
      { id: 'f2', title: 'Chosen', items: [{ bank: { id: 'b1', title: 'Bank', _count: { questions: 7 } } }] },
    ] as never);
    const body = await (await NEXT(req('GET'))).json();
    expect(body.interview.id).toBe('soon');
    expect(body.folder).toEqual({ id: 'f2', title: 'Chosen', banks: [{ id: 'b1', title: 'Bank', questionCount: 7 }] });
  });

  it('falls back to a company title match when no folderId is stored', async () => {
    db.interview.findMany.mockResolvedValue([
      { id: 'i', company: 'Attio', folderId: null, startsAt: inDays(1), endsAt: null, status: 'scheduled' },
    ] as never);
    db.bankFolder.findMany.mockResolvedValue([{ id: 'f1', title: 'Attio Interview Prep', items: [] }] as never);
    const body = await (await NEXT(req('GET'))).json();
    expect(body.folder.id).toBe('f1');
  });
});
