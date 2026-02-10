import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleApiError, NotFoundError, ValidationError } from '@/lib/errors';
import { requireAuth } from '@/lib/auth';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; bankId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id: folderId, bankId } = await params;

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

    // Find and delete the folder-bank link
    const item = await prisma.bankFolderItem.findUnique({
      where: {
        folderId_bankId: { folderId, bankId },
      },
    });

    if (!item) {
      throw new NotFoundError('BankFolderItem', `${folderId}/${bankId}`);
    }

    await prisma.bankFolderItem.delete({
      where: { id: item.id },
    });

    return NextResponse.json({
      message: 'Bank removed from folder successfully',
    });
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code },
      { status: errorData.statusCode }
    );
  }
}
