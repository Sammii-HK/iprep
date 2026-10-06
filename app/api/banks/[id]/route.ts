import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isFactsBankTitle } from '@/lib/fact-sheet';
import { z } from 'zod';
import { handleApiError, NotFoundError, ValidationError } from '@/lib/errors';
import { requireAuth } from '@/lib/auth';

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

    if (!bank || isFactsBankTitle(bank.title)) {
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
    const user = await requireAuth(request);
    const { id } = await params;
    const body = await request.json();
    const validated = UpdateBankSchema.parse(body);

    const bank = await prisma.questionBank.findUnique({
      where: { id },
    });

    if (!bank || isFactsBankTitle(bank.title)) {
      throw new NotFoundError('QuestionBank', id);
    }

    // Verify user owns the bank (unless admin)
    if (bank.userId && bank.userId !== user.id && user.role !== 'ADMIN') {
      throw new ValidationError('You do not have access to this question bank');
    }

    if (isFactsBankTitle(validated.title)) {
      throw new ValidationError('That title is reserved');
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
    const user = await requireAuth(request);
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

    if (!bank || isFactsBankTitle(bank.title)) {
      throw new NotFoundError('QuestionBank', id);
    }

    // Verify user owns the bank (unless admin)
    if (bank.userId && bank.userId !== user.id && user.role !== 'ADMIN') {
      throw new ValidationError('You do not have access to this question bank');
    }

    // The schema does not cascade Question -> bank (or SessionItem/QuizAttempt/UserQuestionProgress ->
    // Question), so a plain delete of a bank that has questions fails with a foreign key error (HTTP 500).
    // Remove dependents in order inside one transaction. Sessions and quizzes keep their rows (bankId is
    // optional and is set to null) so practice history stays in her stats.
    await prisma.$transaction([
      prisma.userQuestionProgress.deleteMany({ where: { question: { bankId: id } } }),
      prisma.quizAttempt.deleteMany({ where: { question: { bankId: id } } }),
      prisma.sessionItem.deleteMany({ where: { question: { bankId: id } } }),
      prisma.question.deleteMany({ where: { bankId: id } }),
      prisma.session.updateMany({ where: { bankId: id }, data: { bankId: null } }),
      prisma.quiz.updateMany({ where: { bankId: id }, data: { bankId: null } }),
      prisma.questionBank.delete({ where: { id } }),
    ]);

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
