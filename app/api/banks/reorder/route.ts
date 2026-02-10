import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { handleApiError, ValidationError } from '@/lib/errors';
import { requireAuth } from '@/lib/auth';

const ReorderItemsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().cuid('Invalid ID format'),
      type: z.enum(['bank', 'folder']),
      order: z.number().int().min(0),
    })
  ),
});

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json();
    const validated = ReorderItemsSchema.parse(body);

    const bankUpdates = validated.items.filter((item) => item.type === 'bank');
    const folderUpdates = validated.items.filter((item) => item.type === 'folder');

    // Verify ownership of all banks and folders before updating
    if (bankUpdates.length > 0) {
      const banks = await prisma.questionBank.findMany({
        where: {
          id: { in: bankUpdates.map((b) => b.id) },
          userId: user.id,
        },
        select: { id: true },
      });
      if (banks.length !== bankUpdates.length) {
        throw new ValidationError('One or more bank IDs are invalid or not owned by you');
      }
    }

    if (folderUpdates.length > 0) {
      const folders = await prisma.bankFolder.findMany({
        where: {
          id: { in: folderUpdates.map((f) => f.id) },
          userId: user.id,
        },
        select: { id: true },
      });
      if (folders.length !== folderUpdates.length) {
        throw new ValidationError('One or more folder IDs are invalid or not owned by you');
      }
    }

    // Update all in a transaction
    await prisma.$transaction([
      ...bankUpdates.map(({ id, order }) =>
        prisma.questionBank.update({
          where: { id },
          data: { order },
        })
      ),
      ...folderUpdates.map(({ id, order }) =>
        prisma.bankFolder.update({
          where: { id },
          data: { order },
        })
      ),
    ]);

    return NextResponse.json({ message: 'Items reordered successfully' });
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
    );
  }
}
