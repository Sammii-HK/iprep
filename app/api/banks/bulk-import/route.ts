import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { parseCSV, parseJSON } from '@/lib/csv';
import { requireAuth } from '@/lib/auth';
import { handleApiError, ValidationError } from '@/lib/errors';

interface ImportResult {
  filename: string;
  success: boolean;
  bankId?: string;
  title?: string;
  questionCount?: number;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      throw new ValidationError('No files provided');
    }

    const results: ImportResult[] = [];

    // Process each file
    for (const file of files) {
      const result: ImportResult = {
        filename: file.name,
        success: false,
      };

      try {
        // Extract title from filename
        const title = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim() || 'Untitled Bank';

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
          result.error = 'Unsupported file type. Use CSV or JSON.';
          results.push(result);
          continue;
        }

        if (questions.length === 0) {
          result.error = 'No valid questions found in file. Please check the CSV format: front,back';
          results.push(result);
          continue;
        }

        // Create bank and questions (associate with user)
        const bank = await prisma.questionBank.create({
          data: {
            title,
            userId: user.id,
            questions: {
              create: questions,
            },
          },
          include: {
            questions: true,
          },
        });

        result.success = true;
        result.bankId = bank.id;
        result.title = bank.title;
        result.questionCount = bank.questions.length;
        results.push(result);
      } catch (error) {
        result.error = error instanceof Error ? error.message : 'Unknown error occurred';
        results.push(result);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    return NextResponse.json({
      results,
      summary: {
        total: results.length,
        successful: successCount,
        failed: failureCount,
      },
    });
  } catch (error) {
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
    );
  }
}

