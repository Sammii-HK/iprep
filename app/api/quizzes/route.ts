import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleApiError, ValidationError, NotFoundError } from '@/lib/errors';
import { z } from 'zod';

const CreateQuizSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(500).optional(),
  type: z.enum(['SPOKEN', 'WRITTEN']),
  bankId: z.string().cuid().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = CreateQuizSchema.parse(body);

    // Validate bank exists if provided
    if (validated.bankId) {
      const bank = await prisma.questionBank.findUnique({
        where: { id: validated.bankId },
        include: { questions: true },
      });

      if (!bank) {
        throw new NotFoundError('QuestionBank', validated.bankId);
      }

      if (bank.questions.length === 0) {
        throw new ValidationError('Question bank has no questions');
      }
    }

    const quiz = await prisma.quiz.create({
      data: {
        title: validated.title,
        description: validated.description,
        type: validated.type,
        bankId: validated.bankId || null,
      },
      include: {
        bank: {
          include: {
            questions: true,
          },
        },
      },
    });

    return NextResponse.json({
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      type: quiz.type,
      bankId: quiz.bankId,
      questionCount: quiz.bank?.questions.length || 0,
      createdAt: quiz.createdAt,
    });
  } catch (error) {
    const errorResponse = handleApiError(error);
    return NextResponse.json(
      {
        error: errorResponse.message,
        code: errorResponse.code,
        ...(errorResponse.details ? { details: errorResponse.details } : {}),
      },
      { status: errorResponse.statusCode }
    );
  }
}

export async function GET() {
  try {
    const quizzes = await prisma.quiz.findMany({
      include: {
        bank: {
          include: {
            _count: {
              select: { questions: true },
            },
          },
        },
        _count: {
          select: { attempts: true },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json(quizzes);
  } catch (error) {
    const errorResponse = handleApiError(error);
    return NextResponse.json(
      { error: errorResponse.message },
      { status: errorResponse.statusCode }
    );
  }
}
