import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { parseCSV, parseJSON } from '@/lib/csv';
import { requireAuth } from '@/lib/auth';
import { z } from 'zod';
import { handleApiError, ValidationError } from '@/lib/errors';

const ImportSchema = z.object({
  title: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    
    const formData = await request.formData();
    const title = formData.get('title') as string;
    const file = formData.get('file') as File;

    if (!file) {
      throw new ValidationError('No file provided');
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
      throw new ValidationError('Unsupported file type. Use CSV or JSON.');
    }

    if (questions.length === 0) {
      throw new ValidationError('No valid questions found in file. Please check the CSV format: front,back');
    }

    // Create bank and questions (associate with user)
    const bank = await prisma.questionBank.create({
      data: {
        title: validated.title,
        userId: user.id,
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
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
    );
  }
}
