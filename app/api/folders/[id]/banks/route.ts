import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isFactsBankTitle } from '@/lib/fact-sheet';
import { z } from 'zod';
import { handleApiError, NotFoundError, ValidationError } from '@/lib/errors';
import { requireAccess } from '@/lib/auth';
import { canReadBank } from '@/lib/access';

const AddBankSchema = z.object({
  bankId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Invalid bank ID format'),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireAccess(request, 'folders:write');
    const { id: folderId } = await params;
    const body = await request.json();
    const validated = AddBankSchema.parse(body);

    // Validate folder ownership
    const folder = await prisma.bankFolder.findUnique({
      where: { id: folderId },
    });

    if (!folder) {
      throw new NotFoundError('BankFolder', folderId);
    }

    if (folder.userId !== user.id) {
      throw new ValidationError('You do not have access to this folder');
    }

    // Validate bank ownership
    const bank = await prisma.questionBank.findUnique({
      where: { id: validated.bankId },
    });

    if (!bank || isFactsBankTitle(bank.title)) {
      throw new NotFoundError('QuestionBank', validated.bankId);
    }

    // Own bank, or shared content (no owner), may be filed into the learner's own folder.
    if (!canReadBank(bank, user)) {
      throw new NotFoundError('QuestionBank', validated.bankId);
    }

    // Auto-assign order = max(existing in folder) + 1
    const maxOrder = await prisma.bankFolderItem.aggregate({
      where: { folderId },
      _max: { order: true },
    });
    const nextOrder = (maxOrder._max.order ?? -1) + 1;

    const item = await prisma.bankFolderItem.create({
      data: {
        folderId,
        bankId: validated.bankId,
        order: nextOrder,
      },
      include: {
        bank: {
          include: {
            _count: { select: { questions: { where: { archivedAt: null } } } },
          },
        },
      },
    });

    return NextResponse.json(
      {
        id: item.id,
        bankId: item.bank.id,
        title: item.bank.title,
        questionCount: item.bank._count.questions,
        order: item.order,
      },
      { status: 201 }
    );
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
    );
  }
}
