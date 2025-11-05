import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleApiError } from '@/lib/errors';

export async function GET() {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;

    // Check if tables exist
    const bankCount = await prisma.questionBank.count();

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      tables: {
        questionBanks: bankCount >= 0, // Just checking if query works
      },
    });
  } catch (error) {
    const errorResponse = handleApiError(error);
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: errorResponse.message,
      },
      { status: errorResponse.statusCode }
    );
  }
}
