import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { handleApiError, NotFoundError, ValidationError } from '@/lib/errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;

    // Get session
    const session = await prisma.session.findUnique({
      where: { id },
    });

    if (!session) {
      throw new NotFoundError('Session', id);
    }

    // Verify user owns the session (unless admin)
    if (session.userId && session.userId !== user.id && user.role !== 'ADMIN') {
      throw new ValidationError('You do not have access to this session');
    }

    // Get learning summary
    const summary = await prisma.learningSummary.findUnique({
      where: { sessionId: id },
    });

    if (!summary) {
      return NextResponse.json(
        { error: 'Session summary not found. Complete the session first.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ summary });
  } catch (error) {
    return handleApiError(error);
  }
}

