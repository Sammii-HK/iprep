import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { z } from 'zod';
import { handleApiError, NotFoundError, ValidationError } from '@/lib/errors';

const CreateSessionSchema = z.object({
  title: z.string().min(1),
  bankId: z.string().cuid('Question bank is required for practice sessions.'),
  maxQuestions: z.number().int().min(1).max(50).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json();
    const validated = CreateSessionSchema.parse(body);

    // Validate bank exists and belongs to user
    const bank = await prisma.questionBank.findUnique({
      where: { id: validated.bankId },
      include: { questions: true },
    });

    if (!bank) {
      throw new NotFoundError('Question bank', validated.bankId);
    }

    // Verify bank belongs to user (unless admin)
    if (bank.userId && bank.userId !== user.id && user.role !== 'ADMIN') {
      throw new ValidationError('You do not have access to this question bank');
    }

    if (bank.questions.length === 0) {
      throw new ValidationError('Question bank has no questions');
    }

    const session = await prisma.session.create({
      data: {
        title: validated.title,
        bankId: validated.bankId,
        userId: user.id,
      },
    });

    return NextResponse.json({
      id: session.id,
      title: session.title,
      bankId: session.bankId,
      createdAt: session.createdAt,
    });
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    
    const sessions = await prisma.session.findMany({
      where: {
        userId: user.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });

    return NextResponse.json(sessions);
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
    );
  }
}