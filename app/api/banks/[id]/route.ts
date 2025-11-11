import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { handleApiError, NotFoundError } from '@/lib/errors';

const UpdateBankSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const bank = await prisma.questionBank.findUnique({
      where: {
        id,
      },
      include: {
        questions: {
          orderBy: {
            id: 'asc',
          },
        },
      },
    });

    if (!bank) {
      throw new NotFoundError('QuestionBank', id);
    }

    return NextResponse.json(bank);
  } catch (error) {
    const errorResponse = handleApiError(error);
    return NextResponse.json(
      { error: errorResponse.message },
      { status: errorResponse.statusCode }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = UpdateBankSchema.parse(body);

    const bank = await prisma.questionBank.findUnique({
      where: { id },
    });

    if (!bank) {
      throw new NotFoundError('QuestionBank', id);
    }

    const updatedBank = await prisma.questionBank.update({
      where: { id },
      data: {
        title: validated.title,
      },
    });

    return NextResponse.json({
      id: updatedBank.id,
      title: updatedBank.title,
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const bank = await prisma.questionBank.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            questions: true,
            quizzes: true,
            sessions: true,
          },
        },
      },
    });

    if (!bank) {
      throw new NotFoundError('QuestionBank', id);
    }

    // Delete the bank (cascade will handle related questions, quizzes, sessions)
    await prisma.questionBank.delete({
      where: { id },
    });

    return NextResponse.json({
      message: 'Question bank deleted successfully',
    });
  } catch (error) {
    const errorResponse = handleApiError(error);
    return NextResponse.json(
      {
        error: errorResponse.message,
        code: errorResponse.code,
      },
      { status: errorResponse.statusCode }
    );
  }
}
