import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { analyzeSessionPerformance, aggregateUserInsights } from '@/lib/learning-analytics';
import { handleApiError, NotFoundError, ValidationError } from '@/lib/errors';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;

    // Get session
    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            question: true,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundError('Session', id);
    }

    // Verify user owns the session (unless admin)
    if (session.userId && session.userId !== user.id && user.role !== 'ADMIN') {
      throw new ValidationError('You do not have access to this session');
    }

    // Check if already completed
    if (session.isCompleted) {
      // Return existing summary
      const existingSummary = await prisma.learningSummary.findUnique({
        where: { sessionId: id },
      });
      if (existingSummary) {
        return NextResponse.json({
          summary: existingSummary,
          message: 'Session already completed',
        });
      }
    }

    // Analyze session performance
    const analysis = await analyzeSessionPerformance(id, user.id);

    // Mark session as completed
    await prisma.session.update({
      where: { id },
      data: {
        isCompleted: true,
        completedAt: new Date(),
      },
    });

    // Create or update learning summary
    const summary = await prisma.learningSummary.upsert({
      where: { sessionId: id },
      create: {
        userId: user.id,
        sessionId: id,
        bankId: session.bankId || null,
        commonMistakes: JSON.parse(JSON.stringify(analysis.commonMistakes)) as Prisma.InputJsonValue,
        weakTags: analysis.weakTags,
        strongTags: analysis.strongTags,
        recommendedFocus: analysis.recommendedFocus,
        performanceByTag: JSON.parse(JSON.stringify(analysis.performanceByTag)) as Prisma.InputJsonValue,
        overallScore: analysis.overallScore,
      },
      update: {
        commonMistakes: JSON.parse(JSON.stringify(analysis.commonMistakes)) as Prisma.InputJsonValue,
        weakTags: analysis.weakTags,
        strongTags: analysis.strongTags,
        recommendedFocus: analysis.recommendedFocus,
        performanceByTag: JSON.parse(JSON.stringify(analysis.performanceByTag)) as Prisma.InputJsonValue,
        overallScore: analysis.overallScore,
      },
    });

    // Trigger user insights aggregation (async, don't wait)
    aggregateUserInsights(user.id).catch((err) => {
      console.error('Error aggregating user insights:', err);
    });

    return NextResponse.json({
      summary,
      message: 'Session completed successfully',
    });
  } catch (error) {
    return handleApiError(error);
  }
}

