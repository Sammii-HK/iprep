import { NextRequest, NextResponse } from 'next/server';
import { QuestionType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { canWriteBank } from '@/lib/access';
import { applyQuestionSet } from '@/lib/content';
import { handleApiError, NotFoundError } from '@/lib/errors';
import { isFactsBankTitle } from '@/lib/fact-sheet-limits';

const QuestionInputSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  externalKey: z.string().min(1).max(128).optional(),
  text: z.string().trim().min(1, 'Question text is required').max(2000),
  hint: z.string().trim().max(4000).optional(),
  tags: z.array(z.string().min(1)).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  type: z.nativeEnum(QuestionType).optional(),
});

const BodySchema = z.object({
  mode: z.enum(['append', 'replace']).default('append'),
  questions: z.array(QuestionInputSchema).min(1, 'At least one question is required').max(1000),
});

/**
 * Identity-preserving question writes (replaces the delete-all-and-recreate route that never reached main).
 * Matching is by id, then externalKey, then exact text; matched questions keep their id and a content change
 * becomes a new revision; `replace` ARCHIVES questions missing from the list instead of deleting them, so old
 * attempts and revisions stay intact and re-sending the same list in any order changes nothing.
 */
async function write(request: NextRequest, params: Promise<{ id: string }>, forced?: 'append' | 'replace') {
  try {
    const { user } = await requireAccess(request, 'banks:write');
    const { id: bankId } = await params;
    const body = BodySchema.parse(await request.json());
    const mode = forced ?? body.mode;

    const bank = await prisma.questionBank.findUnique({ where: { id: bankId }, select: { id: true, title: true, userId: true } });
    if (!bank || isFactsBankTitle(bank.title) || !canWriteBank(bank, user)) throw new NotFoundError('QuestionBank', bankId);

    const applied = await prisma.$transaction((tx) => applyQuestionSet(tx, bankId, body.questions, mode), { timeout: 30_000 });
    const questions = await prisma.question.findMany({
      where: { bankId, archivedAt: null },
      select: { id: true, text: true, hint: true, tags: true, difficulty: true, type: true },
    });
    return NextResponse.json({ bankId, bankTitle: bank.title, mode, questionCount: questions.length, questions, applied });
  } catch (error) {
    const e = handleApiError(error);
    return NextResponse.json({ error: e.message, code: e.code, ...(e.details ? { details: e.details } : {}) }, { status: e.statusCode });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return write(request, params, 'append');
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return write(request, params, 'replace');
}
