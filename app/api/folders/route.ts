import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { handleApiError, ValidationError } from '@/lib/errors';
import { requireAuth } from '@/lib/auth';

const CreateFolderSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  color: z.string().max(50).optional(),
  bankIds: z.array(z.string().cuid('Invalid bank ID format')).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    const folders = await prisma.bankFolder.findMany({
      where: { userId: user.id },
      include: {
        items: {
          include: {
            bank: {
              include: {
                _count: {
                  select: { questions: true },
                },
              },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { order: 'asc' },
    });

    const result = folders.map((folder) => ({
      id: folder.id,
      title: folder.title,
      color: folder.color,
      order: folder.order,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
      banks: folder.items.map((item) => ({
        id: item.bank.id,
        title: item.bank.title,
        questionCount: item.bank._count.questions,
        order: item.order,
      })),
    }));

    return NextResponse.json(result);
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json();
    const validated = CreateFolderSchema.parse(body);

    // Auto-assign order = max(existing) + 1
    const maxOrder = await prisma.bankFolder.aggregate({
      where: { userId: user.id },
      _max: { order: true },
    });
    const nextOrder = (maxOrder._max.order ?? -1) + 1;

    // If bankIds provided, verify ownership
    if (validated.bankIds && validated.bankIds.length > 0) {
      const banks = await prisma.questionBank.findMany({
        where: {
          id: { in: validated.bankIds },
          userId: user.id,
        },
        select: { id: true },
      });

      if (banks.length !== validated.bankIds.length) {
        throw new ValidationError('One or more bank IDs are invalid or not owned by you');
      }
    }

    const folder = await prisma.bankFolder.create({
      data: {
        userId: user.id,
        title: validated.title,
        color: validated.color,
        order: nextOrder,
        items: validated.bankIds?.length
          ? {
              create: validated.bankIds.map((bankId, index) => ({
                bankId,
                order: index,
              })),
            }
          : undefined,
      },
      include: {
        items: {
          include: {
            bank: {
              include: {
                _count: { select: { questions: true } },
              },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });

    return NextResponse.json(
      {
        id: folder.id,
        title: folder.title,
        color: folder.color,
        order: folder.order,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        banks: folder.items.map((item) => ({
          id: item.bank.id,
          title: item.bank.title,
          questionCount: item.bank._count.questions,
          order: item.order,
        })),
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
