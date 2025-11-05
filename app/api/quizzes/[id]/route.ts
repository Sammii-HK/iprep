import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleApiError, NotFoundError } from '@/lib/errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const quiz = await prisma.quiz.findUnique({
      where: { id },
      include: {
        bank: {
          include: {
            questions: {
              orderBy: {
                id: 'asc',
              },
            },
          },
        },
        attempts: {
          include: {
            question: true,
          },
          orderBy: {
            startedAt: 'desc',
          },
        },
      },
    });

    if (!quiz) {
      throw new NotFoundError('Quiz', id);
    }

    return NextResponse.json({
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      type: quiz.type,
      questions: quiz.bank?.questions || [],
      attempts: quiz.attempts,
      createdAt: quiz.createdAt,
    });
  } catch (error) {
    const errorResponse = handleApiError(error);
    return NextResponse.json(
      { error: errorResponse.message },
      { status: errorResponse.statusCode }
    );
  }
}
