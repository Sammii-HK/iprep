import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const bank = await prisma.questionBank.findUnique({
      where: {
        id,
      },
      include: {
        questions: {
          orderBy: {
            id: 'asc',
          },
        },
      },
    });

    if (!bank) {
      return NextResponse.json({ error: 'Bank not found' }, { status: 404 });
    }

    return NextResponse.json(bank);
  } catch (error) {
    console.error('Error fetching bank:', error);
    return NextResponse.json({ error: 'Failed to fetch bank' }, { status: 500 });
  }
}
