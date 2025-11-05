import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { z } from 'zod';

const CreateSessionSchema = z.object({
  title: z.string().min(1),
  bankId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = CreateSessionSchema.parse(body);

    const session = await prisma.session.create({
      data: {
        title: validated.title,
        bankId: validated.bankId || null,
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