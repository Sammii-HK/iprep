import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { analyzeSessionPerformance } from '@/lib/learning-analytics';
import { handleApiError } from '@/lib/errors';

/**
 * Backfill learning summaries for all completed sessions that don't have one
 * Admin only endpoint
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    // Only allow admin users
    if (user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized - Admin access required' },
        { status: 403 }
      );
    }

    // Get all completed sessions without summaries
    const sessionsWithoutSummaries = await prisma.session.findMany({
      where: {
        isCompleted: true,
        summary: null,
        items: {
          some: {},
        },
      },
      include: {
        items: {
          include: {
            question: true,
          },
        },
      },
    });

    if (sessionsWithoutSummaries.length === 0) {
      return NextResponse.json({
        message: 'All completed sessions already have summaries',
        processed: 0,
        errors: [],
      });
    }

    const results = {
      processed: 0,
      errors: [] as Array<{ sessionId: string; error: string }>,
    };

    // Process each session
    for (const session of sessionsWithoutSummaries) {
      try {
        // Analyze session performance
        const analysis = await analyzeSessionPerformance(session.id, session.userId || '');

        // Create learning summary with error handling for missing column
        try {
          await prisma.learningSummary.upsert({
            where: { sessionId: session.id },
            create: {
              userId: session.userId || '',
              sessionId: session.id,
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
            console.warn(`frequentlyForgottenPoints column not found for session ${session.id}, creating without it`);
            await prisma.learningSummary.upsert({
              where: { sessionId: session.id },
              create: {
                userId: session.userId || '',
                sessionId: session.id,
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

        results.processed++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.errors.push({
          sessionId: session.id,
          error: errorMessage,
        });
        console.error(`Error processing session ${session.id}:`, error);
      }
    }

    return NextResponse.json({
      message: `Processed ${results.processed} sessions, ${results.errors.length} errors`,
      ...results,
    });
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
    );
  }
}

