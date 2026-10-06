import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { ownsRecord } from '@/lib/access';
import { analyzeSessionPerformance, aggregateUserInsights } from '@/lib/learning-analytics';
import { handleApiError, NotFoundError } from '@/lib/errors';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireAccess(request, 'sessions:write');
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

    // Owner only. A session with no owner is never accessible here.
    if (!ownsRecord(session, user)) {
      throw new NotFoundError('Session', id);
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
    // Handle missing frequentlyForgottenPoints column gracefully
    let summary;
    try {
      summary = await prisma.learningSummary.upsert({
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
    } catch (error) {
      // If frequentlyForgottenPoints column doesn't exist, create/update without it
      if (error instanceof Error && error.message.includes('frequentlyForgottenPoints')) {
        console.warn('frequentlyForgottenPoints column not found, creating/updating without it');
        summary = await prisma.learningSummary.upsert({
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
      } else {
        throw error;
      }
    }

    // Trigger user insights aggregation (async, don't wait)
    aggregateUserInsights(user.id).catch((err) => {
      console.error('Error aggregating user insights:', err);
    });

    return NextResponse.json({
      summary,
      message: 'Session completed successfully',
    });
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
    );
  }
}

