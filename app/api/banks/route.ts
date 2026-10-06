import { NextRequest, NextResponse } from 'next/server';
import { QuestionType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { isFactsBankTitle, notFactsBank } from '@/lib/fact-sheet';
import { requireAccess } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import { assertFolderOwned } from '@/lib/interviews-api';
import { z } from 'zod';

const CreateBankSchema = z.object({
  title: z.string().min(1).max(200),
  folderId: z.string().min(1).max(64).optional(),
  questions: z
    .array(
      z.object({
        text: z.string().min(1).max(2000),
        hint: z.string().max(4000).optional().default(''),
        type: z.nativeEnum(QuestionType).optional(),
        difficulty: z.number().int().min(1).max(5).optional(),
        tags: z.array(z.string().min(1).max(60)).max(20).optional(),
      })
    )
    .min(1)
    .max(1000),
});

export async function POST(request: NextRequest) {
  try {
    // Signed-in humans, or a machine principal holding banks:write.
    const { user } = await requireAccess(request, 'banks:write');
    const parsed = CreateBankSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'title and questions are required and must be valid', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }
    const body = parsed.data;

    // A bank can only be filed into a folder the actor owns.
    await assertFolderOwned(user.id, body.folderId);

    if (isFactsBankTitle(body.title)) {
      return NextResponse.json(
        { error: 'That title is reserved', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const bank = await prisma.questionBank.create({
      data: {
        title: body.title,
        userId: user.id,
        questions: {
          create: body.questions.map((q) => ({
            text: q.text,
            hint: q.hint,
            type: q.type || QuestionType.TECHNICAL,
            difficulty: q.difficulty || 3,
            tags: q.tags || [],
          })),
        },
        ...(body.folderId && {
          folderItems: {
            create: {
              folderId: body.folderId,
            },
          },
        }),
      },
      include: {
        _count: { select: { questions: true } },
      },
    });

    return NextResponse.json({
      id: bank.id,
      title: bank.title,
      questionCount: bank._count.questions,
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
    const { user } = await requireAccess(request, 'banks:read');
    const includeFolders = request.nextUrl.searchParams.get('includeFolders') === 'true';

    if (!includeFolders) {
      // Original response format for backward compatibility
      const banks = await prisma.questionBank.findMany({
        where: {
          userId: user.id,
          ...notFactsBank,
        },
        include: {
          _count: {
            select: {
              questions: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return NextResponse.json(banks);
    }

    // Unified response with folders and banks
    const [banks, folders] = await Promise.all([
      prisma.questionBank.findMany({
        where: { userId: user.id, ...notFactsBank },
        include: {
          _count: { select: { questions: true } },
          folderItems: { select: { folderId: true } },
        },
        orderBy: { order: 'asc' },
      }),
      prisma.bankFolder.findMany({
        where: { userId: user.id },
        include: {
          items: {
            where: { bank: notFactsBank },
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
        orderBy: { order: 'asc' },
      }),
    ]);

    // Banks in at least one folder should NOT appear at top level
    const banksInFolders = new Set(
      folders.flatMap((f) => f.items.map((item) => item.bankId))
    );

    const items: Array<
      | { type: 'bank'; id: string; title: string; order: number; questionCount: number; createdAt: string }
      | { type: 'folder'; id: string; title: string; color: string | null; order: number; banks: Array<{ id: string; title: string; questionCount: number; order: number }> }
    > = [];

    // Add top-level banks (not in any folder)
    for (const bank of banks) {
      if (!banksInFolders.has(bank.id)) {
        items.push({
          type: 'bank',
          id: bank.id,
          title: bank.title,
          order: bank.order,
          questionCount: bank._count.questions,
          createdAt: bank.createdAt.toISOString(),
        });
      }
    }

    // Add folders with nested banks
    for (const folder of folders) {
      items.push({
        type: 'folder',
        id: folder.id,
        title: folder.title,
        color: folder.color,
        order: folder.order,
        banks: folder.items.map((item) => ({
          id: item.bank.id,
          title: item.bank.title,
          questionCount: item.bank._count.questions,
          order: item.order,
        })),
      });
    }

    // Sort all items by order
    items.sort((a, b) => a.order - b.order);

    return NextResponse.json({ items });
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
    );
  }
}
