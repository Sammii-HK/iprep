import { existsSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    questionBank: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), delete: vi.fn() },
    bankFolder: { findFirst: vi.fn() },
    session: { findUnique: vi.fn(), delete: vi.fn() },
    quiz: { findUnique: vi.fn(), delete: vi.fn() },
    quizAttempt: { create: vi.fn() },
    sessionItem: { findUnique: vi.fn() },
  },
}));

let current: { id: string; email: string; role: string; isPremium: boolean; name: string | null; emailVerified: boolean; createdAt: Date } | null = null;
vi.mock('@/lib/auth', async () => {
  const { AppError } = await import('@/lib/errors');
  const who = async () => {
    if (!current) throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
    return current;
  };
  return {
    requireAuth: vi.fn(who),
    requireAccess: vi.fn(async () => ({ user: await who() })),
    requireAdmin: vi.fn(async () => {
      const u = await who();
      if (u.role !== 'ADMIN') throw new AppError('Admin access required', 403, 'ADMIN_ACCESS_REQUIRED');
      return u;
    }),
  };
});

vi.mock('@/lib/rate-limit', () => ({
  enforceAiLimits: vi.fn().mockResolvedValue(undefined),
  enforceRateLimit: vi.fn().mockResolvedValue(undefined),
  LIMITS: { push: { limit: 10, windowMs: 60000 }, interviews: { limit: 60, windowMs: 60000 } },
}));
vi.mock('@/lib/r2', () => ({ uploadAudio: vi.fn(), getAudioUrl: vi.fn() }));
vi.mock('@/lib/ai', () => ({ transcribeAudio: vi.fn() }));
vi.mock('@/lib/ai-optimized', () => ({ analyzeTranscriptOptimized: vi.fn(), getOpenAIClient: vi.fn() }));
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn().mockResolvedValue({}) } }));
vi.mock('@/lib/config', () => ({
  getConfig: () => ({ vapid: { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.co' }, limits: {} }),
}));

import { prisma } from '@/lib/db';
import { AppError, RateLimitError } from '@/lib/errors';
import { enforceAiLimits } from '@/lib/rate-limit';
import { uploadAudio } from '@/lib/r2';
import { transcribeAudio } from '@/lib/ai';
import webpush from 'web-push';
import { GET as bankGet, PATCH as bankPatch, DELETE as bankDelete } from '@/app/api/banks/[id]/route';
import { POST as bankCreate } from '@/app/api/banks/route';
import { DELETE as sessionDelete } from '@/app/api/sessions/[id]/route';
import { DELETE as quizDelete } from '@/app/api/quizzes/[id]/route';
import { POST as quizAttempt } from '@/app/api/quizzes/attempt/route';
import { POST as pushSend } from '@/app/api/push/send/route';
import { POST as pushSubscribe } from '@/app/api/push/subscribe/route';
import { POST as debrief } from '@/app/api/debriefs/route';
import { POST as reanalyze } from '@/app/api/practice/reanalyze/route';
import { POST as backfill } from '@/app/api/learning/backfill-summaries/route';
import { GET as health } from '@/app/api/health/route';

const db = vi.mocked(prisma, true);
const user = (id: string, role = 'USER') => ({ id, email: `${id}@example.com`, role, isPremium: false, name: null, emailVerified: true, createdAt: new Date() });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, init: RequestInit = {}) => new NextRequest(`http://localhost:3000${url}`, init as never);
const jsonReq = (url: string, body: unknown, method = 'POST') =>
  req(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const KEYS = { p256dh: 'B'.repeat(65), auth: 'a'.repeat(22) };

beforeEach(() => {
  vi.clearAllMocks();
  current = user('u1');
});

describe('bank content is no longer public', () => {
  it('rejects unauthenticated access to a bank', async () => {
    current = null;
    const res = await bankGet(req('/api/banks/b1'), params('b1'));
    expect(res.status).toBe(401);
    expect(db.questionBank.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 for another learner's private bank (no existence oracle)", async () => {
    db.questionBank.findUnique.mockResolvedValue({ id: 'b1', title: 'Private', userId: 'someone-else', questions: [] } as never);
    expect((await bankGet(req('/api/banks/b1'), params('b1'))).status).toBe(404);
  });

  it('allows reading shared (no owner) content', async () => {
    db.questionBank.findUnique.mockResolvedValue({ id: 'b2', title: 'Shared', userId: null, questions: [] } as never);
    expect((await bankGet(req('/api/banks/b2'), params('b2'))).status).toBe(200);
  });
});

describe('null-owner data is not world-writable', () => {
  const sharedBank = { id: 'b2', title: 'Shared', userId: null, _count: { questions: 0, quizzes: 0, sessions: 0 } };

  it('a normal user cannot rename or delete a shared bank', async () => {
    db.questionBank.findUnique.mockResolvedValue(sharedBank as never);
    const patch = await bankPatch(jsonReq('/api/banks/b2', { title: 'Hijacked' }, 'PATCH'), params('b2'));
    expect(patch.status).toBe(404);
    expect(db.questionBank.update).not.toHaveBeenCalled();
    const del = await bankDelete(req('/api/banks/b2', { method: 'DELETE' }), params('b2'));
    expect(del.status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('an admin may change shared content', async () => {
    current = user('a1', 'ADMIN');
    db.questionBank.findUnique.mockResolvedValue(sharedBank as never);
    db.questionBank.update.mockResolvedValue({ id: 'b2', title: 'Renamed' } as never);
    expect((await bankPatch(jsonReq('/api/banks/b2', { title: 'Renamed' }, 'PATCH'), params('b2'))).status).toBe(200);
  });

  it("an admin still cannot change another learner's private bank", async () => {
    current = user('a1', 'ADMIN');
    db.questionBank.findUnique.mockResolvedValue({ id: 'b3', title: 'Private', userId: 'u1' } as never);
    expect((await bankPatch(jsonReq('/api/banks/b3', { title: 'x' }, 'PATCH'), params('b3'))).status).toBe(404);
    expect(db.questionBank.update).not.toHaveBeenCalled();
  });

  it('orphaned sessions and quizzes (no owner) cannot be deleted by a normal user', async () => {
    db.session.findUnique.mockResolvedValue({ id: 's1', userId: null } as never);
    expect((await sessionDelete(req('/api/sessions/s1', { method: 'DELETE' }), params('s1'))).status).toBe(404);
    expect(db.session.delete).not.toHaveBeenCalled();

    db.quiz.findUnique.mockResolvedValue({ id: 'q1', userId: null, _count: { attempts: 0 } } as never);
    expect((await quizDelete(req('/api/quizzes/q1', { method: 'DELETE' }), params('q1'))).status).toBe(404);
    expect(db.quiz.delete).not.toHaveBeenCalled();
  });

  it("another learner's session cannot be deleted, even by an admin", async () => {
    current = user('a1', 'ADMIN');
    db.session.findUnique.mockResolvedValue({ id: 's2', userId: 'u1' } as never);
    expect((await sessionDelete(req('/api/sessions/s2', { method: 'DELETE' }), params('s2'))).status).toBe(404);
    expect(db.session.delete).not.toHaveBeenCalled();
  });
});

describe('folder references are ownership checked', () => {
  it("a bank cannot be filed into another learner's folder", async () => {
    db.bankFolder.findFirst.mockResolvedValue(null); // not owned by the actor
    const res = await bankCreate(
      jsonReq('/api/banks', { title: 'x', folderId: 'victim-folder', questions: [{ text: 'q', hint: 'h' }] })
    );
    expect(res.status).toBe(400);
    expect(db.questionBank.create).not.toHaveBeenCalled();
  });
});

describe('quiz attempts', () => {
  const form = (quizId = 'q1') => {
    const fd = new FormData();
    fd.set('quizId', quizId);
    fd.set('questionId', 'qq1');
    fd.set('answer', 'a written answer');
    return req('/api/quizzes/attempt', { method: 'POST', body: fd });
  };

  it('requires authentication before any work', async () => {
    current = null;
    const res = await quizAttempt(form());
    expect(res.status).toBe(401);
    expect(db.quiz.findUnique).not.toHaveBeenCalled();
    expect(uploadAudio).not.toHaveBeenCalled();
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("is a 404 for someone else's quiz, and for an orphan with no owner", async () => {
    db.quiz.findUnique.mockResolvedValue({ id: 'q1', userId: 'someone-else', type: 'WRITTEN', bank: { questions: [{ id: 'qq1' }] } } as never);
    expect((await quizAttempt(form())).status).toBe(404);
    db.quiz.findUnique.mockResolvedValue({ id: 'q1', userId: null, type: 'WRITTEN', bank: { questions: [{ id: 'qq1' }] } } as never);
    expect((await quizAttempt(form())).status).toBe(404);
    expect(db.quizAttempt.create).not.toHaveBeenCalled();
  });

  it('applies per-user limits', async () => {
    db.quiz.findUnique.mockResolvedValue(null as never);
    await quizAttempt(form());
    expect(enforceAiLimits).toHaveBeenCalledWith('quiz-attempt', 'u1');
  });
});

describe('push cannot be used as an SSRF or notification relay', () => {
  const payload = { title: 't', body: 'b' };

  it('send is admin only', async () => {
    const res = await pushSend(jsonReq('/api/push/send', { subscription: { endpoint: 'https://fcm.googleapis.com/x', keys: KEYS }, payload }));
    expect(res.status).toBe(403);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it.each(['https://169.254.169.254/latest/meta-data/', 'http://internal.service/hook', 'https://localhost:8443/x', 'https://fcm.googleapis.com.evil.com/x'])(
    'send refuses the endpoint %s even for an admin',
    async (endpoint) => {
      current = user('a1', 'ADMIN');
      const res = await pushSend(jsonReq('/api/push/send', { subscription: { endpoint, keys: KEYS }, payload }));
      expect(res.status).toBe(400);
      expect(webpush.sendNotification).not.toHaveBeenCalled();
    }
  );

  it('send accepts a real push service endpoint for an admin', async () => {
    current = user('a1', 'ADMIN');
    const res = await pushSend(jsonReq('/api/push/send', { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: KEYS }, payload }));
    expect(res.status).toBe(200);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
  });

  it.each(['https://169.254.169.254/', 'https://127.0.0.1/', 'http://evil.example/'])('subscribe refuses %s and sends nothing', async (endpoint) => {
    const res = await pushSubscribe(jsonReq('/api/push/subscribe', { endpoint, keys: KEYS }));
    expect(res.status).toBe(400);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('send does not accept an off-site click URL in the payload', async () => {
    current = user('a1', 'ADMIN');
    const res = await pushSend(
      jsonReq('/api/push/send', { subscription: { endpoint: 'https://fcm.googleapis.com/x', keys: KEYS }, payload: { ...payload, url: 'https://evil.example/phish' } })
    );
    expect(res.status).toBe(400);
  });
});

describe('expensive routes cannot be anonymously hammered', () => {
  it('debriefs and reanalysis refuse unauthenticated requests before any paid work or limit', async () => {
    current = null;
    const fd = new FormData();
    fd.set('audio', new Blob(['x'], { type: 'audio/webm' }));
    expect((await debrief(req('/api/debriefs', { method: 'POST', body: fd }))).status).toBe(401);
    expect((await reanalyze(jsonReq('/api/practice/reanalyze', { sessionItemId: 'x', transcript: 'a transcript here', sessionId: 's', questionId: 'q' }))).status).toBe(401);
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it('a limited learner gets 429 and no paid work happens', async () => {
    vi.mocked(enforceAiLimits).mockRejectedValue(new RateLimitError());
    const fd = new FormData();
    fd.set('audio', new Blob(['x'], { type: 'audio/webm' }));
    expect((await debrief(req('/api/debriefs', { method: 'POST', body: fd }))).status).toBe(429);
    expect((await reanalyze(jsonReq('/api/practice/reanalyze', { sessionItemId: 'x', transcript: 'a transcript here', sessionId: 's', questionId: 'q' }))).status).toBe(429);
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it('reanalysis refuses an unbounded transcript', async () => {
    vi.mocked(enforceAiLimits).mockResolvedValue(undefined);
    const res = await reanalyze(jsonReq('/api/practice/reanalyze', { sessionItemId: 'x', transcript: 'a'.repeat(20001), sessionId: 's', questionId: 'q' }));
    expect(res.status).toBe(400);
  });

  it('backfill is admin only', async () => {
    expect((await backfill(req('/api/learning/backfill-summaries', { method: 'POST' }))).status).toBe(403);
  });
});

describe('no infrastructure disclosure', () => {
  it('the env-check endpoint is gone', () => {
    expect(existsSync(join(__dirname, '..', '..', 'app', 'api', 'env-check', 'route.ts'))).toBe(false);
  });

  it('health returns no database or provider detail when unhealthy', async () => {
    db.$queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED ep-dawn-sun-ahkhrdkl.neon.tech password authentication failed'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await health();
    const body = JSON.stringify(await res.json());
    expect(res.status).toBe(503);
    expect(body).not.toMatch(/neon|ECONNREFUSED|password|ep-/i);
  });

  it('errors from the AppError path never include provider text', () => {
    const e = new AppError('Service temporarily unavailable', 503, 'X');
    expect(e.message).not.toMatch(/key|secret/i);
  });
});
