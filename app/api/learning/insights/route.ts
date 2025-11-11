import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { isPremiumUser } from '@/lib/premium';
import { aggregateUserInsights } from '@/lib/learning-analytics';
import { handleApiError, ValidationError } from '@/lib/errors';

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    // Check premium access
    if (!isPremiumUser(user)) {
      throw new ValidationError('Premium access required for learning insights');
    }

    // Check if insights need to be updated (if they don't exist or are stale)
    let insights;
    try {
      insights = await prisma.userLearningInsight.findUnique({
        where: { userId: user.id },
      });
    } catch (error) {
      // If topForgottenPoints column doesn't exist, handle gracefully
      if (error instanceof Error && error.message.includes('topForgottenPoints')) {
        console.warn('topForgottenPoints column not found, fetching insights without it');
        // Try to fetch using raw query to avoid Prisma type issues
        const rawInsights = await prisma.$queryRawUnsafe<Array<{
          id: string;
          userId: string;
          aggregatedWeakTags: string[];
          aggregatedStrongTags: string[];
          topFocusAreas: string[];
          totalSessions: number;
          totalQuestions: number;
          lastUpdated: Date;
        }>>(
          `SELECT id, "userId", "aggregatedWeakTags", "aggregatedStrongTags", "topFocusAreas", "totalSessions", "totalQuestions", "lastUpdated" 
           FROM "UserLearningInsight" 
           WHERE "userId" = $1`,
          user.id
        );
        insights = rawInsights[0] || null;
      } else {
        throw error;
      }
    }

    // Check if we have completed sessions that might not be aggregated
    const completedSessionsCount = await prisma.session.count({
      where: {
        userId: user.id,
        isCompleted: true,
      },
    });

    // If no insights exist, or if we have sessions but insights are stale/empty, aggregate
    const shouldAggregate = !insights || 
      (completedSessionsCount > 0 && insights && (
        insights.totalSessions === 0 || 
        !insights.lastUpdated ||
        (insights.lastUpdated.getTime() < Date.now() - 5 * 60 * 1000) // 5 minutes ago
      ));

    if (shouldAggregate) {
      // Trigger aggregation (this will update or create insights)
      try {
        await aggregateUserInsights(user.id);
        // Fetch updated insights
        insights = await prisma.userLearningInsight.findUnique({
          where: { userId: user.id },
        });
      } catch (error) {
        console.error('Error aggregating insights:', error);
        // Continue with existing insights if aggregation fails
      }
    }

    // If still no insights exist, create empty record
    if (!insights) {
      insights = await prisma.userLearningInsight.create({
        data: {
          userId: user.id,
          aggregatedWeakTags: [],
          aggregatedStrongTags: [],
          topFocusAreas: [],
          totalSessions: 0,
          totalQuestions: 0,
        },
      });
    }

    return NextResponse.json({ insights });
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
    );
  }
}

