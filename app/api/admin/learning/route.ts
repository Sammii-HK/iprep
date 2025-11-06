import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const insights = await prisma.userLearningInsight.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
      orderBy: {
        lastUpdated: 'desc',
      },
    });

    return NextResponse.json({ insights });
  } catch (error) {
    return handleApiError(error);
  }
}

