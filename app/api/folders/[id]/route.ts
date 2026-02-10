import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { handleApiError, NotFoundError, ValidationError } from '@/lib/errors';
import { requireAuth } from '@/lib/auth';

const UpdateFolderSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long').optional(),
  color: z.string().max(50).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    const body = await request.json();
    const validated = UpdateFolderSchema.parse(body);

    const folder = await prisma.bankFolder.findUnique({
      where: { id },
    });

    if (!folder) {
      throw new NotFoundError('BankFolder', id);
    }

    if (folder.userId !== user.id) {
      throw new ValidationError('You do not have access to this folder');
    }

    const updated = await prisma.bankFolder.update({
      where: { id },
      data: {
        ...(validated.title !== undefined && { title: validated.title }),
        ...(validated.color !== undefined && { color: validated.color }),
      },
    });

    return NextResponse.json({
      id: updated.id,
      title: updated.title,
      color: updated.color,
      order: updated.order,
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
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

    const folder = await prisma.bankFolder.findUnique({
      where: { id },
    });

    if (!folder) {
      throw new NotFoundError('BankFolder', id);
    }

    if (folder.userId !== user.id) {
      throw new ValidationError('You do not have access to this folder');
    }

    // Deletes folder and cascades to BankFolderItem links (not the actual banks)
    await prisma.bankFolder.delete({
      where: { id },
    });

    return NextResponse.json({
      message: 'Folder deleted successfully',
    });
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code },
      { status: errorData.statusCode }
    );
  }
}
