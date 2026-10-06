import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => {
  const requireAuth = vi.fn();
  // Routes that accept machine principals call requireAccess; in these tests it resolves to the signed-in user.
  return { requireAuth, requireAccess: vi.fn(async (...args: unknown[]) => ({ user: await (requireAuth as (...a: unknown[]) => unknown)(...args) })) };
});

vi.mock('@/lib/fact-sheet', async () => {
  const limits = await vi.importActual<typeof import('@/lib/fact-sheet-limits')>(
    '@/lib/fact-sheet-limits'
  );
  return { ...limits, getFactSheet: vi.fn(), setFactSheet: vi.fn() };
});

import { requireAuth } from '@/lib/auth';
import { getFactSheet, setFactSheet, FACT_SHEET_MAX_CHARS } from '@/lib/fact-sheet';
import { AppError } from '@/lib/errors';
import { GET, PUT } from '@/app/api/user/facts/route';

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  role: 'USER',
  isPremium: false,
  emailVerified: true,
  createdAt: new Date(),
};

function put(body: unknown, raw = false): Request {
  return new Request('http://localhost:3000/api/user/facts', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

describe('/api/user/facts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(mockUser);
  });

  it('GET returns the sheet and the cap', async () => {
    vi.mocked(getFactSheet).mockResolvedValue('My record');
    const res = await GET(new Request('http://localhost:3000/api/user/facts') as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'My record', maxChars: FACT_SHEET_MAX_CHARS });
    expect(getFactSheet).toHaveBeenCalledWith('user-1');
  });

  it('GET returns null text when there is no sheet', async () => {
    vi.mocked(getFactSheet).mockResolvedValue(null);
    const res = await GET(new Request('http://localhost:3000/api/user/facts') as never);
    expect((await res.json()).text).toBeNull();
  });

  it('requires authentication', async () => {
    vi.mocked(requireAuth).mockRejectedValue(
      new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED')
    );
    const getRes = await GET(new Request('http://localhost:3000/api/user/facts') as never);
    const putRes = await PUT(put({ text: 'x' }) as never);
    expect(getRes.status).toBe(401);
    expect(putRes.status).toBe(401);
    expect(setFactSheet).not.toHaveBeenCalled();
  });

  it('PUT saves a valid sheet for the signed in user', async () => {
    vi.mocked(setFactSheet).mockResolvedValue('Saved');
    const res = await PUT(put({ text: 'Saved' }) as never);
    expect(res.status).toBe(200);
    expect(setFactSheet).toHaveBeenCalledWith('user-1', 'Saved');
    expect((await res.json()).text).toBe('Saved');
  });

  it('PUT accepts an empty string to clear the sheet', async () => {
    vi.mocked(setFactSheet).mockResolvedValue(null);
    const res = await PUT(put({ text: '' }) as never);
    expect(res.status).toBe(200);
    expect(setFactSheet).toHaveBeenCalledWith('user-1', '');
  });

  it('PUT accepts exactly the maximum length', async () => {
    vi.mocked(setFactSheet).mockResolvedValue('ok');
    const res = await PUT(put({ text: 'a'.repeat(FACT_SHEET_MAX_CHARS) }) as never);
    expect(res.status).toBe(200);
  });

  it('PUT rejects text over the cap with 400', async () => {
    const res = await PUT(put({ text: 'a'.repeat(FACT_SHEET_MAX_CHARS + 1) }) as never);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.code).toBe('VALIDATION_ERROR');
    expect(data.error).toMatch(/too long/i);
    expect(setFactSheet).not.toHaveBeenCalled();
  });

  it.each([
    ['missing text', {}],
    ['non-string text', { text: 42 }],
    ['null body', null],
  ])('PUT rejects %s with 400', async (_name, body) => {
    const res = await PUT(put(body) as never);
    expect(res.status).toBe(400);
    expect(setFactSheet).not.toHaveBeenCalled();
  });

  it('PUT rejects invalid JSON with 400', async () => {
    const res = await PUT(put('{not json', true) as never);
    expect(res.status).toBe(400);
  });

  it('PUT rejects an oversized declared body', async () => {
    const req = new Request('http://localhost:3000/api/user/facts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'content-length': String(1024 * 1024) },
      body: JSON.stringify({ text: 'x' }),
    });
    const res = await PUT(req as never);
    expect(res.status).toBe(400);
  });
});
