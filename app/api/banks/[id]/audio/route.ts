import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isFactsBankTitle } from '@/lib/fact-sheet';
import { handleApiError, NotFoundError } from '@/lib/errors';
import { getAudioUrl } from '@/lib/r2';
import { requireAccess } from '@/lib/auth';
import { canReadBank } from '@/lib/access';
import { enforceRateLimit } from '@/lib/rate-limit';
import { existsSync, statSync } from 'fs';
import { join } from 'path';

/** Slugify a bank title to match local audio filenames */
function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * GET /api/banks/[id]/audio
 * Check if a study audio session exists locally or on R2
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Signed-in humans, or a machine principal holding banks:read. This route makes outbound requests to
    // R2 and reveals which banks exist, so it is no longer public and is rate limited per learner.
    const { user } = await requireAccess(request, 'banks:read');
    await enforceRateLimit({ key: `bank-audio:${user.id}`, limit: 120, windowMs: 60_000 });
    const { id } = await params;

    const bank = await prisma.questionBank.findUnique({
      where: { id },
      select: { id: true, title: true, userId: true },
    });

    if (!bank || isFactsBankTitle(bank.title) || !canReadBank(bank, user)) {
      throw new NotFoundError('QuestionBank', id);
    }

    // 1. Check local audio files first (by bank title slug)
    const slug = slugify(bank.title);
    const localDir = join(process.cwd(), 'public', 'audio', 'study');
    const localPath = join(localDir, `${slug}.mp3`);

    if (existsSync(localPath)) {
      const stats = statSync(localPath);
      return NextResponse.json({
        hasAudio: true,
        url: `/audio/study/${slug}.mp3`,
        transcriptUrl: null,
        fileSizeBytes: stats.size,
      });
    }

    // 2. Also check by bank ID (for files uploaded directly to public/)
    const localPathById = join(localDir, `${id}.mp3`);
    if (existsSync(localPathById)) {
      const stats = statSync(localPathById);
      return NextResponse.json({
        hasAudio: true,
        url: `/audio/study/${id}.mp3`,
        transcriptUrl: null,
        fileSizeBytes: stats.size,
      });
    }

    // 3. Fall back to R2
    const audioUrl = getAudioUrl(`audio/study/${id}.mp3`);

    try {
      const head = await fetch(audioUrl, { method: 'HEAD' });
      if (!head.ok) {
        return NextResponse.json({ hasAudio: false });
      }

      const transcriptUrl = getAudioUrl(`audio/study/${id}.txt`);
      const transcriptHead = await fetch(transcriptUrl, { method: 'HEAD' });

      return NextResponse.json({
        hasAudio: true,
        url: audioUrl,
        transcriptUrl: transcriptHead.ok ? transcriptUrl : null,
        fileSizeBytes: Number(head.headers.get('content-length') || 0),
      });
    } catch {
      return NextResponse.json({ hasAudio: false });
    }
  } catch (error) {
    const errorResponse = handleApiError(error);
    return NextResponse.json(
      { error: errorResponse.message },
      { status: errorResponse.statusCode }
    );
  }
}
