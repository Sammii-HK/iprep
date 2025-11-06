import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const [
      totalUsers,
      activeUsers,
      premiumUsers,
      totalSessions,
      totalBanks,
      totalQuestions,
      recentUsers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({
        where: {
          sessions: {
            some: {
              createdAt: {
                gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
              },
            },
          },
        },
      }),
      prisma.user.count({
        where: {
          isPremium: true,
        },
      }),
      prisma.session.count(),
      prisma.questionBank.count(),
      prisma.question.count(),
      prisma.user.findMany({
        take: 10,
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
        },
      }),
    ]);

    return NextResponse.json({
      metrics: {
        totalUsers,
        activeUsers,
        premiumUsers,
        totalSessions,
        totalBanks,
        totalQuestions,
      },
      subscriptionStats: {
        premiumUsers,
        freeUsers: totalUsers - premiumUsers,
        premiumPercentage: totalUsers > 0 ? (premiumUsers / totalUsers) * 100 : 0,
      },
      recentUsers,
    });
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
    );
  }
}

