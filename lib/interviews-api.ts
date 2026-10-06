import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { prisma } from '@/lib/db';
import { LIMITS, enforceRateLimit as enforceDurableLimit } from '@/lib/rate-limit';
import { ValidationError, handleApiError } from '@/lib/errors';

/** Durable per-learner limit shared by the interview routes. Keyed by user id, not by IP. */
export async function enforceRateLimit(_request: NextRequest, userId: string): Promise<void> {
  await enforceDurableLimit({ key: `interviews:${userId}`, ...LIMITS.interviews });
}

export async function parseJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
}

/** Rejects a folderId that does not belong to the user. */
export async function assertFolderOwned(userId: string, folderId: string | null | undefined): Promise<void> {
  if (!folderId) return;
  const folder = await prisma.bankFolder.findFirst({ where: { id: folderId, userId }, select: { id: true } });
  if (!folder) throw new ValidationError('Folder not found');
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    return NextResponse.json(
      { error: `${where}${issue?.message ?? 'Invalid request'}`, code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }
  const errorData = handleApiError(error);
  return NextResponse.json(
    { error: errorData.message, code: errorData.code, details: errorData.details },
    { status: errorData.statusCode },
  );
}
