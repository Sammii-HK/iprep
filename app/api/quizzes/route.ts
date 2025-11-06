import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { handleApiError, ValidationError, NotFoundError } from '@/lib/errors';
import { z } from 'zod';

const CreateQuizSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(500).optional(),
  type: z.enum(['SPOKEN', 'WRITTEN']),
  bankId: z.string().cuid('Question bank is required. Quizzes must be built from a CSV question bank.'),
  maxQuestions: z.number().int().min(1).max(50).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json();
    const validated = CreateQuizSchema.parse(body);

    // Validate bank exists and belongs to user (required for quizzes)
    const bank = await prisma.questionBank.findUnique({
      where: { id: validated.bankId },
      include: { questions: true },
    });

    if (!bank) {
      throw new NotFoundError('QuestionBank', validated.bankId);
    }

    // Verify user owns the bank (unless admin)
    if (bank.userId && bank.userId !== user.id && user.role !== 'ADMIN') {
      throw new ValidationError('You do not have access to this question bank');
    }

    if (bank.questions.length === 0) {
      throw new ValidationError('Question bank has no questions');
    }

    const quiz = await prisma.quiz.create({
      data: {
        title: validated.title,
        description: validated.description,
        type: validated.type,
        bankId: validated.bankId,
        userId: user.id,
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

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    
    const quizzes = await prisma.quiz.findMany({
      where: {
        userId: user.id,
      },
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
