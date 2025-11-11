import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
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

    // Check if session is completed, if not, try to complete it first
    if (!session.isCompleted) {
      // Try to complete the session if it has items
      const sessionWithItems = await prisma.session.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              question: true,
            },
          },
        },
      });

      if (sessionWithItems && sessionWithItems.items.length > 0) {
        // Auto-complete the session to generate summary
        try {
          const { analyzeSessionPerformance } = await import('@/lib/learning-analytics');
          const analysis = await analyzeSessionPerformance(id, user.id);

          await prisma.session.update({
            where: { id },
            data: {
              isCompleted: true,
              completedAt: new Date(),
            },
          });

          const summary = await prisma.learningSummary.upsert({
            where: { sessionId: id },
            create: {
              userId: user.id,
              sessionId: id,
              bankId: session.bankId || null,
              commonMistakes: JSON.parse(JSON.stringify(analysis.commonMistakes)) as Prisma.InputJsonValue,
              frequentlyForgottenPoints: JSON.parse(JSON.stringify(analysis.frequentlyForgottenPoints)) as Prisma.InputJsonValue,
              weakTags: analysis.weakTags,
              strongTags: analysis.strongTags,
              recommendedFocus: analysis.recommendedFocus,
              performanceByTag: JSON.parse(JSON.stringify(analysis.performanceByTag)) as Prisma.InputJsonValue,
              overallScore: analysis.overallScore,
            },
            update: {
              commonMistakes: JSON.parse(JSON.stringify(analysis.commonMistakes)) as Prisma.InputJsonValue,
              frequentlyForgottenPoints: JSON.parse(JSON.stringify(analysis.frequentlyForgottenPoints)) as Prisma.InputJsonValue,
              weakTags: analysis.weakTags,
              strongTags: analysis.strongTags,
              recommendedFocus: analysis.recommendedFocus,
              performanceByTag: JSON.parse(JSON.stringify(analysis.performanceByTag)) as Prisma.InputJsonValue,
              overallScore: analysis.overallScore,
            },
          });

          return NextResponse.json({ 
            summary,
            bankId: session.bankId,
          });
        } catch (error) {
          console.error('Error auto-completing session:', error);
          // Fall through to return 404 if auto-completion fails
        }
      }
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

    return NextResponse.json({ 
      summary,
      bankId: session.bankId, // Include bankId so we can create a new session with filtered questions
    });
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
    );
  }
}

