import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleApiError, NotFoundError } from '@/lib/errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const maxQuestionsParam = searchParams.get('maxQuestions');
    const maxQuestions = maxQuestionsParam ? parseInt(maxQuestionsParam, 10) : undefined;
    
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

    // Limit questions based on maxQuestions query param
    let questions = quiz.bank?.questions || [];
    if (maxQuestions && maxQuestions > 0 && questions.length > maxQuestions) {
      questions = questions.slice(0, maxQuestions);
    }
    
    return NextResponse.json({
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      type: quiz.type,
      questions,
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
