import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isFactsBankTitle } from '@/lib/fact-sheet';
import { z } from 'zod';
import { handleApiError, NotFoundError, ValidationError } from '@/lib/errors';
import { requireAccess, requireAuth } from '@/lib/auth';
import { canReadBank, canWriteBank } from '@/lib/access';

const UpdateBankSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Signed-in humans, or a machine principal holding banks:read.
    const { user } = await requireAccess(request, 'banks:read');
    const { id } = await params;
    const bank = await prisma.questionBank.findUnique({
      where: {
        id,
      },
      include: {
        questions: {
          where: { archivedAt: null },
          orderBy: {
            id: 'asc',
          },
        },
      },
    });

    // 404 (not 403) for a bank the actor cannot read, so ids cannot be probed.
    if (!bank || isFactsBankTitle(bank.title) || !canReadBank(bank, user)) {
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

    // Owner, or an admin for shared (no owner) content. An unowned bank is NOT writable by every signed-in user.
    if (!canWriteBank(bank, user)) {
      throw new NotFoundError('QuestionBank', id);
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
            questions: { where: { archivedAt: null } },
            quizzes: true,
            sessions: true,
          },
        },
      },
    });

    if (!bank || isFactsBankTitle(bank.title)) {
      throw new NotFoundError('QuestionBank', id);
    }

    // Owner, or an admin for shared (no owner) content.
    if (!canWriteBank(bank, user)) {
      throw new NotFoundError('QuestionBank', id);
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
