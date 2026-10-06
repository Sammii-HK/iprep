import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { NotFoundError } from '@/lib/errors';
import { UpdateInterviewSchema } from '@/lib/interviews';
import { assertFolderOwned, enforceRateLimit, errorResponse, parseJson } from '@/lib/interviews-api';

type Params = { params: Promise<{ id: string }> };

async function findOwned(userId: string, id: string) {
  const interview = await prisma.interview.findFirst({ where: { id, userId } });
  if (!interview) throw new NotFoundError('Interview', id);
  return interview;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    await enforceRateLimit(request);
    const user = await requireAuth(request);
    const { id } = await params;
    const data = UpdateInterviewSchema.parse(await parseJson(request));
    await findOwned(user.id, id);
    await assertFolderOwned(user.id, data.folderId);

    const interview = await prisma.interview.update({ where: { id }, data });
    return NextResponse.json({ interview });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    await enforceRateLimit(request);
    const user = await requireAuth(request);
    const { id } = await params;
    await findOwned(user.id, id);
    await prisma.interview.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
