import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    questionBank: { findFirst: vi.fn(), create: vi.fn() },
    question: { createMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/ai', () => ({
  transcribeAudio: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
}));

const create = vi.fn();
vi.mock('@/lib/ai-optimized', () => ({
  getOpenAIClient: () => ({ chat: { completions: { create } } }),
  getChatModel: () => 'test-model',
}));

import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { transcribeAudio } from '@/lib/ai';
import { checkRateLimit } from '@/lib/rate-limit';
import { AppError } from '@/lib/errors';
import { POST } from '@/app/api/debriefs/route';

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  role: 'USER',
  isPremium: false,
  emailVerified: true,
  createdAt: new Date(),
};

const transcript =
  'They asked me how CSS specificity works and then why I wanted the role. I froze a bit on the accessibility question.';

const llmJson = JSON.stringify({
  questionsAsked: ['How does CSS specificity work?', 'Why do you want this role?'],
  wentWell: ['Clear answer on specificity'],
  stumbled: ['Froze on accessibility'],
  followUps: ['Revise focus management'],
  oneThingToFix: 'Prepare a calm accessibility answer.',
});

function request(fields: Record<string, string | Blob | undefined> = {}): Request {
  const form = new FormData();
  const entries = { audio: new Blob(['audio'], { type: 'audio/webm' }), ...fields };
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined) continue;
    if (typeof value === 'string') form.set(key, value);
    else form.set(key, value, 'debrief.webm');
  }
  return new Request('http://localhost:3000/api/debriefs', {
    method: 'POST',
    body: form,
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
}

describe('POST /api/debriefs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(mockUser);
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    vi.mocked(transcribeAudio).mockResolvedValue({ transcript });
    create.mockResolvedValue({ choices: [{ message: { content: llmJson } }] });
    vi.mocked(prisma.questionBank.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.questionBank.create).mockResolvedValue({ id: 'bank-1', questions: [] } as never);
  });

  it('transcribes, structures, saves questions and returns the debrief', async () => {
    const res = await POST(
      request({ company: ' Acme ', role: 'Design Engineer', stage: 'Technical' }) as never
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.transcript).toBe(transcript);
    expect(data.context).toEqual({ company: 'Acme', role: 'Design Engineer', stage: 'Technical' });
    expect(data.debrief.questionsAsked).toHaveLength(2);
    expect(data.debrief.oneThingToFix).toBe('Prepare a calm accessibility answer.');
    expect(data.bank).toEqual({
      id: 'bank-1',
      title: 'Real interview questions (debriefs)',
      added: 2,
      skipped: 0,
    });

    const saved = vi.mocked(prisma.question.createMany).mock.calls[0][0] as {
      data: Array<{ tags: string[]; type: string }>;
    };
    expect(saved.data.map((q) => q.tags)).toEqual([
      ['Acme', 'debrief'],
      ['Acme', 'debrief'],
    ]);
    expect(saved.data[0].type).toBe('TECHNICAL');
  });

  it('works with only audio (company, role and stage are optional)', async () => {
    const res = await POST(request() as never);
    expect(res.status).toBe(200);
    expect((await res.json()).context).toEqual({});
  });

  it('sends the LLM a strict JSON request using the transcript only', async () => {
    await POST(request({ company: 'Acme' }) as never);
    const arg = create.mock.calls[0][0] as {
      response_format: { type: string };
      messages: Array<{ role: string; content: string }>;
    };
    expect(arg.response_format).toEqual({ type: 'json_object' });
    expect(arg.messages[1].content).toContain(transcript);
    expect(arg.messages[1].content).toContain('Company: Acme');
  });

  it('rejects a request with no audio', async () => {
    const form = new FormData();
    form.set('company', 'Acme');
    const res = await POST(
      new Request('http://localhost:3000/api/debriefs', { method: 'POST', body: form }) as never
    );
    expect(res.status).toBe(400);
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it('rejects an unsupported file type', async () => {
    const res = await POST(
      request({ audio: new Blob(['x'], { type: 'text/plain' }) }) as never
    );
    expect(res.status).toBe(400);
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it('rejects a recording that is too short to debrief', async () => {
    vi.mocked(transcribeAudio).mockResolvedValue({ transcript: 'Um, it went okay.' });
    const res = await POST(request() as never);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/too short/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('returns 502 when transcription fails, without touching the bank', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(transcribeAudio).mockRejectedValue(new Error('whisper down'));
    const res = await POST(request() as never);
    expect(res.status).toBe(502);
    expect(prisma.questionBank.create).not.toHaveBeenCalled();
  });

  it('returns 502 when the model keeps returning malformed output, and saves nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    create.mockResolvedValue({ choices: [{ message: { content: 'sorry, no JSON here' } }] });
    const res = await POST(request() as never);
    expect(res.status).toBe(502);
    expect(prisma.question.createMany).not.toHaveBeenCalled();
  });

  it('survives one malformed model reply by retrying', async () => {
    create
      .mockResolvedValueOnce({ choices: [{ message: { content: 'oops' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: llmJson } }] });
    const res = await POST(request() as never);
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('does not duplicate questions already in the bank', async () => {
    vi.mocked(prisma.questionBank.findFirst).mockResolvedValue({
      id: 'bank-1',
      questions: [{ text: 'How does CSS specificity work?' }, { text: 'Why do you want this role?' }],
    } as never);
    const res = await POST(request() as never);
    const data = await res.json();
    expect(data.bank).toMatchObject({ added: 0, skipped: 2 });
    expect(prisma.question.createMany).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    vi.mocked(requireAuth).mockRejectedValue(
      new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED')
    );
    const res = await POST(request() as never);
    expect(res.status).toBe(401);
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it('is rate limited', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    const res = await POST(request() as never);
    expect(res.status).toBe(429);
  });
});
