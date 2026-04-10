import { NextRequest, NextResponse } from 'next/server';
import { QuestionType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json() as { title: string; folderId?: string; questions: Array<{ text: string; hint: string; type?: string; difficulty?: number; tags?: string[] }> };

    if (!body.title || !body.questions?.length) {
      return NextResponse.json(
        { error: 'title and questions are required', code: 'VALIDATION_ERROR' },
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
            type: (q.type as QuestionType) || QuestionType.TECHNICAL,
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
    const user = await requireAuth(request);
    const includeFolders = request.nextUrl.searchParams.get('includeFolders') === 'true';

    if (!includeFolders) {
      // Original response format for backward compatibility
      const banks = await prisma.questionBank.findMany({
        where: {
          userId: user.id,
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
        where: { userId: user.id },
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
