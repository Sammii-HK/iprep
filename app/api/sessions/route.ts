import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { z } from 'zod';
import { handleApiError, NotFoundError, ValidationError } from '@/lib/errors';

const CreateSessionSchema = z.object({
  title: z.string().min(1),
  bankId: z.string().cuid('Question bank is required for practice sessions.'),
  maxQuestions: z.number().int().min(1).max(50).optional(),
  filterTags: z.array(z.string()).optional(), // Filter questions by tags (for weak topics practice)
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json();
    const validated = CreateSessionSchema.parse(body);

    // Validate bank exists and belongs to user
    const bank = await prisma.questionBank.findUnique({
      where: { id: validated.bankId },
      include: { questions: true },
    });

    if (!bank) {
      throw new NotFoundError('Question bank', validated.bankId);
    }

    // Verify bank belongs to user (unless admin)
    if (bank.userId && bank.userId !== user.id && user.role !== 'ADMIN') {
      throw new ValidationError('You do not have access to this question bank');
    }

    // Filter questions by tags if provided
    let questions = bank.questions;
    if (validated.filterTags && validated.filterTags.length > 0) {
      questions = bank.questions.filter((q) => 
        q.tags.some((tag) => validated.filterTags!.includes(tag))
      );
    }

    if (questions.length === 0) {
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
        userId: user.id,
        filterTags: validated.filterTags || [],
      },
    });

    return NextResponse.json({
      id: session.id,
      title: session.title,
      bankId: session.bankId,
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
    const user = await requireAuth(request);
    
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