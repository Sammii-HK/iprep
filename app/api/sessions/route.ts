import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isFactsBankTitle } from '@/lib/fact-sheet';
import { requireAccess } from '@/lib/auth';
import { canReadBank } from '@/lib/access';
import { z } from 'zod';
import { handleApiError, NotFoundError, ValidationError } from '@/lib/errors';

const CreateSessionSchema = z.object({
  title: z.string().min(1),
  bankId: z.string().min(1, 'Question bank is required for practice sessions.'),
  // Optional extra banks for a multi-bank session; bankId stays the primary one.
  extraBankIds: z.array(z.string().min(1)).max(7).optional(),
  maxQuestions: z.number().int().min(1).max(50).optional(),
  filterTags: z.array(z.string()).optional(), // Filter questions by tags (for weak topics practice)
});

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAccess(request, 'sessions:write');
    const body = await request.json();
    const validated = CreateSessionSchema.parse(body);

    // Validate bank exists and belongs to user
    const bank = await prisma.questionBank.findUnique({
      where: { id: validated.bankId },
      include: { questions: { where: { archivedAt: null } } },
    });

    if (!bank || isFactsBankTitle(bank.title)) {
      throw new NotFoundError('Question bank', validated.bankId);
    }

    // Own bank or shared content only.
    if (!canReadBank(bank, user)) {
      throw new NotFoundError('Question bank', validated.bankId);
    }

    // Extra banks: each must exist, be readable and not be the facts bank; duplicates are ignored.
    const extraBankIds = [...new Set(validated.extraBankIds ?? [])].filter((id) => id !== validated.bankId);
    let extraQuestionCount = 0;
    if (extraBankIds.length > 0) {
      const extras = await prisma.questionBank.findMany({
        where: { id: { in: extraBankIds } },
        include: { _count: { select: { questions: true } } },
      });
      for (const id of extraBankIds) {
        const b = extras.find((x) => x.id === id);
        if (!b || isFactsBankTitle(b.title) || !canReadBank(b, user)) {
          throw new NotFoundError('Question bank', id);
        }
        extraQuestionCount += b._count.questions;
      }
    }

    // Filter questions by tags if provided
    let questions = bank.questions;
    if (validated.filterTags && validated.filterTags.length > 0) {
      questions = bank.questions.filter((q) => 
        q.tags.some((tag) => validated.filterTags!.includes(tag))
      );
    }

    if (questions.length === 0 && extraQuestionCount === 0) {
      throw new ValidationError(
        validated.filterTags && validated.filterTags.length > 0
          ? 'No questions found matching the selected topics. Try practicing all questions or different topics.'
          : 'Question bank has no questions'
      );
    }

    const session = await prisma.session.create({
      data: {
        title: validated.title,
        bankId: validated.bankId,
        extraBankIds,
        userId: user.id,
        filterTags: validated.filterTags || [],
      },
    });

    return NextResponse.json({
      id: session.id,
      title: session.title,
      bankId: session.bankId,
      extraBankIds,
      createdAt: session.createdAt,
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
    const { user } = await requireAccess(request, 'sessions:read');
    
    const sessions = await prisma.session.findMany({
      where: {
        userId: user.id,
      },
      include: {
        _count: {
          select: {
            items: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });

    // Map sessions and handle filterTags gracefully (in case migration hasn't run)
    const formattedSessions = sessions.map((session) => {
      const sessionWithFilterTags = session as typeof session & { filterTags?: string[] };
      return {
        id: session.id,
        title: session.title,
        bankId: session.bankId,
        extraBankIds: (session as typeof session & { extraBankIds?: string[] }).extraBankIds ?? [],
        createdAt: session.createdAt.toISOString(),
        isCompleted: session.isCompleted,
        completedAt: session.completedAt?.toISOString() || null,
        filterTags: sessionWithFilterTags.filterTags || [],
        itemCount: session._count.items,
      };
    });

    return NextResponse.json(formattedSessions);
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
    );
  }
}