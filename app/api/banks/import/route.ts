import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { parseCSV, parseJSON } from '@/lib/csv';
import { z } from 'zod';

const ImportSchema = z.object({
  title: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const title = formData.get('title') as string;
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate title
    const validated = ImportSchema.parse({ title });

    // Read file content
    const content = await file.text();
    const contentType = file.type;

    // Parse based on content type
    let questions;
    if (contentType.includes('csv') || file.name.endsWith('.csv')) {
      questions = parseCSV(content);
    } else if (contentType.includes('json') || file.name.endsWith('.json')) {
      questions = parseJSON(content);
    } else {
      return NextResponse.json(
        { error: 'Unsupported file type. Use CSV or JSON.' },
        { status: 400 }
      );
    }

    if (questions.length === 0) {
      return NextResponse.json(
        { error: 'No valid questions found in file' },
        { status: 400 }
      );
    }

    // Create bank and questions
    const bank = await prisma.questionBank.create({
      data: {
        title: validated.title,
        questions: {
          create: questions,
        },
      },
      include: {
        questions: true,
      },
    });

    return NextResponse.json({
      id: bank.id,
      title: bank.title,
      questionCount: bank.questions.length,
    });
  } catch (error) {
    console.error('Error importing bank:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to import bank' },
      { status: 500 }
    );
  }
}
