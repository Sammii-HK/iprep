import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies
vi.mock('@/lib/db', () => ({
  prisma: {
    session: { findUnique: vi.fn() },
    question: { findUnique: vi.fn() },
    sessionItem: { create: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/r2', () => ({
  uploadAudio: vi.fn().mockResolvedValue('audio-key-123'),
  getAudioUrl: vi.fn().mockReturnValue('https://r2.example.com/audio-key-123'),
}));

vi.mock('@/lib/ai', () => ({
  transcribeAudio: vi.fn(),
}));

vi.mock('@/lib/ai-optimized', () => ({
  analyzeTranscriptOptimized: vi.fn(),
}));

vi.mock('@/lib/enhanced-audio-analysis', () => ({
  analyzeConfidenceEnhanced: vi.fn().mockReturnValue(3.5),
  analyzeIntonationEnhanced: vi.fn().mockReturnValue(3.0),
  analyzeVoiceQuality: vi.fn().mockReturnValue({
    pacingScore: 3.0,
    emphasisScore: 3.0,
    engagementScore: 3.0,
  }),
}));

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn().mockReturnValue({
    limits: {
      rateLimitWindowMs: 60000,
      rateLimitRequests: 100,
    },
  }),
}));

vi.mock('@/lib/validation', () => ({
  validateAudioFile: vi.fn().mockReturnValue({ valid: true }),
  validateId: vi.fn().mockReturnValue(true),
}));

import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { transcribeAudio } from '@/lib/ai';
import { analyzeTranscriptOptimized } from '@/lib/ai-optimized';
import { validateId } from '@/lib/validation';
import { POST } from '@/app/api/practice/route';

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  role: 'USER',
  isPremium: false,
  emailVerified: true,
  createdAt: new Date(),
};

const mockSession = {
  id: 'csession1aaaaaaaaaaaaaaa',
  title: 'Practice',
  bankId: 'cbank1aaaaaaaaaaaaaaaaaa',
  userId: 'user-1',
  bank: { id: 'cbank1aaaaaaaaaaaaaaaaaa', title: 'Test Bank' },
};

const mockQuestion = {
  id: 'cquestion1aaaaaaaaaaaaaa',
  text: 'Tell me about a time you led a team.',
  hint: 'Use STAR method.',
  tags: ['leadership', 'teamwork'],
  difficulty: 3,
  type: 'BEHAVIORAL',
  bankId: 'cbank1aaaaaaaaaaaaaaaaaa',
  bank: { id: 'cbank1aaaaaaaaaaaaaaaaaa' },
};

const mockAnalysis = {
  questionAnswered: true,
  answerQuality: 4,
  whatWasRight: ['Good use of STAR method', 'Specific metrics provided'],
  betterWording: ['Could add more context'],
  dontForget: ['Mention team size'],
  starScore: 4,
  impactScore: 3.5,
  clarityScore: 4,
  technicalAccuracy: 3,
  terminologyUsage: 3,
  tips: ['Great structure', 'Add more quantified impact'],
};

function createPracticeFormData(overrides: Record<string, string | Blob> = {}): FormData {
  const formData = new FormData();
  const audioBlob = new Blob(['fake-audio-data'], { type: 'audio/webm' });
  formData.append('audio', audioBlob, 'recording.webm');
  formData.append('sessionId', mockSession.id);
  formData.append('questionId', mockQuestion.id);
  Object.entries(overrides).forEach(([key, value]) => {
    formData.set(key, value);
  });
  return formData;
}

function createFormDataRequest(formData: FormData): Request {
  return new Request('http://localhost:3000/api/practice', {
    method: 'POST',
    body: formData,
    headers: {
      'x-forwarded-for': '127.0.0.1',
    },
  });
}

describe('POST /api/practice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(mockUser);
    vi.mocked(prisma.session.findUnique).mockResolvedValue(mockSession as never);
    vi.mocked(prisma.question.findUnique).mockResolvedValue(mockQuestion as never);
    vi.mocked(prisma.sessionItem.create).mockResolvedValue({ id: 'item-1' } as never);
    vi.mocked(transcribeAudio).mockResolvedValue({
      transcript: 'At my previous company I led a team of eight engineers through a major migration project. The situation was that our monolithic application was becoming unmaintainable. I took the lead on creating a phased migration plan.',
      words: [
        { word: 'At', start: 0, end: 0.2 },
        { word: 'my', start: 0.2, end: 0.4 },
        { word: 'previous', start: 0.4, end: 0.8 },
      ],
    });
    vi.mocked(analyzeTranscriptOptimized).mockResolvedValue(mockAnalysis);
  });

  it('processes a valid practice submission', async () => {
    const formData = createPracticeFormData();
    const req = createFormDataRequest(formData);

    const response = await POST(req as never);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.transcript).toBeDefined();
    expect(data.metrics).toBeDefined();
    expect(data.metrics.words).toBeGreaterThan(0);
    expect(data.scores).toBeDefined();
    expect(data.scores.star).toBe(4);
    expect(data.scores.impact).toBe(3.5);
    expect(data.scores.clarity).toBe(4);
    expect(data.scores.confidence).toBeDefined();
    expect(data.scores.intonation).toBeDefined();
    expect(data.scores.conciseness).toBeDefined();
    expect(data.tips).toEqual(mockAnalysis.tips);
    expect(data.answerQuality).toBe(4);
    expect(data.whatWasRight).toEqual(mockAnalysis.whatWasRight);
  });

  it('returns 400 when audio is missing', async () => {
    const formData = new FormData();
    formData.append('sessionId', mockSession.id);
    formData.append('questionId', mockQuestion.id);

    const req = createFormDataRequest(formData);
    const response = await POST(req as never);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Missing required fields');
  });

  it('returns 400 when sessionId is missing', async () => {
    const formData = new FormData();
    const audioBlob = new Blob(['audio'], { type: 'audio/webm' });
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('questionId', mockQuestion.id);

    const req = createFormDataRequest(formData);
    const response = await POST(req as never);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Missing required fields');
  });

  it('returns 400 when questionId is missing', async () => {
    const formData = new FormData();
    const audioBlob = new Blob(['audio'], { type: 'audio/webm' });
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('sessionId', mockSession.id);

    const req = createFormDataRequest(formData);
    const response = await POST(req as never);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Missing required fields');
  });

  it('returns 400 for invalid session/question ID format', async () => {
    vi.mocked(validateId).mockReturnValue(false);

    const formData = createPracticeFormData({
      sessionId: 'not-a-valid-id',
      questionId: 'also-not-valid',
    });

    const req = createFormDataRequest(formData);
    const response = await POST(req as never);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Invalid');

    // Restore mock
    vi.mocked(validateId).mockReturnValue(true);
  });

  it('returns 404 when session not found', async () => {
    vi.mocked(prisma.session.findUnique).mockResolvedValue(null as never);

    const formData = createPracticeFormData();
    const req = createFormDataRequest(formData);
    const response = await POST(req as never);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toContain('not found');
  });

  it('returns 404 when question not found', async () => {
    vi.mocked(prisma.question.findUnique).mockResolvedValue(null as never);

    const formData = createPracticeFormData();
    const req = createFormDataRequest(formData);
    const response = await POST(req as never);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toContain('not found');
  });

  it('returns 400 when session belongs to another user', async () => {
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      ...mockSession,
      userId: 'other-user-id',
    } as never);

    const formData = createPracticeFormData();
    const req = createFormDataRequest(formData);
    const response = await POST(req as never);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('access');
  });

  it('returns 400 when question does not belong to session bank', async () => {
    vi.mocked(prisma.question.findUnique).mockResolvedValue({
      ...mockQuestion,
      bankId: 'cdifferentbankidaaaaaaaaa',
    } as never);

    const formData = createPracticeFormData();
    const req = createFormDataRequest(formData);
    const response = await POST(req as never);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('does not belong');
  });

  it('returns error when not authenticated', async () => {
    const authError = new Error('Authentication required') as Error & { statusCode: number; code: string };
    authError.statusCode = 401;
    authError.code = 'AUTHENTICATION_REQUIRED';
    vi.mocked(requireAuth).mockRejectedValue(authError);

    const formData = createPracticeFormData();
    const req = createFormDataRequest(formData);
    const response = await POST(req as never);

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('handles empty transcript gracefully', async () => {
    vi.mocked(transcribeAudio).mockResolvedValue({
      transcript: '',
      words: [],
    });

    const formData = createPracticeFormData();
    const req = createFormDataRequest(formData);
    const response = await POST(req as never);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('empty');
  });

  it('handles short transcript with fallback analysis', async () => {
    vi.mocked(transcribeAudio).mockResolvedValue({
      transcript: 'I dunno',
      words: [
        { word: 'I', start: 0, end: 0.2 },
        { word: 'dunno', start: 0.3, end: 0.6 },
      ],
    });

    const formData = createPracticeFormData();
    const req = createFormDataRequest(formData);
    const response = await POST(req as never);
    const data = await response.json();

    expect(response.status).toBe(200);
    // Should return fallback analysis for very short response
    expect(data.answerQuality).toBe(1);
    expect(data.tips).toBeDefined();
    // Should NOT call AI analysis for < 5 words
    expect(analyzeTranscriptOptimized).not.toHaveBeenCalled();
  });

  it('handles transcription service failure', async () => {
    vi.mocked(transcribeAudio).mockRejectedValue(new Error('OpenAI service unavailable'));

    const formData = createPracticeFormData();
    const req = createFormDataRequest(formData);
    const response = await POST(req as never);
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.error).toContain('Failed to transcribe');
  });

  it('handles AI analysis failure with fallback', async () => {
    vi.mocked(analyzeTranscriptOptimized).mockRejectedValue(new Error('Analysis timeout'));

    const formData = createPracticeFormData();
    const req = createFormDataRequest(formData);
    const response = await POST(req as never);
    const data = await response.json();

    // Should still succeed with fallback analysis
    expect(response.status).toBe(200);
    expect(data.transcript).toBeDefined();
    expect(data.scores).toBeDefined();
    expect(data.answerQuality).toBe(2); // fallback quality
  });

  it('saves session item to database', async () => {
    const formData = createPracticeFormData();
    const req = createFormDataRequest(formData);

    await POST(req as never);

    expect(prisma.sessionItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sessionId: mockSession.id,
        questionId: mockQuestion.id,
        transcript: expect.any(String),
        words: expect.any(Number),
        wpm: expect.any(Number),
        fillerCount: expect.any(Number),
      }),
    });
  });

  it('includes conciseness and voice quality scores in response', async () => {
    const formData = createPracticeFormData();
    const req = createFormDataRequest(formData);
    const response = await POST(req as never);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.scores.conciseness).toBeDefined();
    expect(data.scores.pacing).toBeDefined();
    expect(data.scores.emphasis).toBeDefined();
    expect(data.scores.engagement).toBeDefined();
  });

  it('accepts coaching preferences', async () => {
    const preferences = {
      focusAreas: ['star-method', 'clarity'],
      priorities: ['impact statements'],
    };

    const formData = createPracticeFormData({
      preferences: JSON.stringify(preferences),
    });

    const req = createFormDataRequest(formData);
    const response = await POST(req as never);

    expect(response.status).toBe(200);
    expect(analyzeTranscriptOptimized).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Array),
      undefined,
      undefined,
      expect.any(String),
      expect.any(String),
      preferences,
      expect.any(Object),
      expect.any(String),
    );
  });
});
