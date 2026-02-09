import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { QUESTION_BANK_TEMPLATES } from '@/lib/templates';
import { handleApiError, ValidationError } from '@/lib/errors';

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    const { templateId } = await request.json();
    if (!templateId) {
      throw new ValidationError('No template ID provided');
    }

    const template = QUESTION_BANK_TEMPLATES.find((t) => t.id === templateId);
    if (!template) {
      throw new ValidationError('Template not found');
    }

    const bank = await prisma.questionBank.create({
      data: {
        title: template.title,
        userId: user.id,
        questions: {
          create: template.questions.map((q) => ({
            text: q.text,
            hint: q.hint || null,
            tags: q.tags,
            difficulty: q.difficulty,
            type: q.type as "BEHAVIORAL" | "TECHNICAL" | "DEFINITION" | "SCENARIO" | "PITCH",
          })),
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
