import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { isPremiumUser } from '@/lib/premium';
import { handleApiError, ValidationError } from '@/lib/errors';

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    // Check premium access
    if (!isPremiumUser(user)) {
      throw new ValidationError('Premium access required for learning insights');
    }

    // Get or create user learning insights
    let insights = await prisma.userLearningInsight.findUnique({
      where: { userId: user.id },
    });

    // If no insights exist, create empty record
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

