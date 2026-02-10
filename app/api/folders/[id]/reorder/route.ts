import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { handleApiError, NotFoundError, ValidationError } from '@/lib/errors';
import { requireAuth } from '@/lib/auth';

const ReorderBanksSchema = z.object({
  bankIds: z.array(
    z.object({
      bankId: z.string().cuid('Invalid bank ID format'),
      order: z.number().int().min(0),
    })
  ),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id: folderId } = await params;
    const body = await request.json();
    const validated = ReorderBanksSchema.parse(body);

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

    // Update all items in a transaction
    await prisma.$transaction(
      validated.bankIds.map(({ bankId, order }) =>
        prisma.bankFolderItem.update({
          where: {
            folderId_bankId: { folderId, bankId },
          },
          data: { order },
        })
      )
    );

    return NextResponse.json({ message: 'Banks reordered successfully' });
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
    );
  }
}
