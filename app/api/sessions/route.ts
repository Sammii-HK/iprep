import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { z } from 'zod';

const CreateSessionSchema = z.object({
  title: z.string().min(1),
  bankId: z.string().cuid('Question bank is required for practice sessions.'),
  maxQuestions: z.number().int().min(1).max(50).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = CreateSessionSchema.parse(body);

    // Validate bank exists
    const bank = await prisma.questionBank.findUnique({
      where: { id: validated.bankId },
      include: { questions: true },
    });

    if (!bank) {
      return NextResponse.json(
        { error: 'Question bank not found' },
        { status: 404 }
      );
    }

    if (bank.questions.length === 0) {
      return NextResponse.json(
        { error: 'Question bank has no questions' },
        { status: 400 }
      );
    }

    const session = await prisma.session.create({
      data: {
        title: validated.title,
        bankId: validated.bankId,
      },
    });

    return NextResponse.json({
      id: session.id,
      title: session.title,
      bankId: session.bankId,
      createdAt: session.createdAt,
    });
  } catch (error) {
    console.error('Error creating session:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: 'Failed to create session' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const sessions = await prisma.session.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      take: 20,
    });

    return NextResponse.json(sessions);
  } catch (error) {
    console.error('Error fetching sessions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sessions' },
      { status: 500 }
    );
  }
}