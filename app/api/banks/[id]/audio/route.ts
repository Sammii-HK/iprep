import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleApiError, NotFoundError } from '@/lib/errors';
import { getAudioUrl } from '@/lib/r2';

/**
 * GET /api/banks/[id]/audio
 * Check if a study audio session exists for this bank on R2
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const bank = await prisma.questionBank.findUnique({
      where: { id },
      select: { id: true, title: true },
    });

    if (!bank) {
      throw new NotFoundError('QuestionBank', id);
    }

    // Check if audio exists on R2 by doing a HEAD request
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
