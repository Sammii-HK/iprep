import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { CreateInterviewSchema, visibleInterviews } from '@/lib/interviews';
import { assertFolderOwned, enforceRateLimit, errorResponse, parseJson } from '@/lib/interviews-api';

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    await enforceRateLimit(request, user.id);
    const includePast = request.nextUrl.searchParams.get('includePast') === 'true';
    const now = new Date();

    const all = await prisma.interview.findMany({
      where: { userId: user.id },
      orderBy: { startsAt: 'asc' },
    });
    const interviews = visibleInterviews(all, now, includePast);

    return NextResponse.json({ interviews });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    await enforceRateLimit(request, user.id);
    const data = CreateInterviewSchema.parse(await parseJson(request));
    await assertFolderOwned(user.id, data.folderId);

    const interview = await prisma.interview.create({
      data: { ...data, userId: user.id, source: 'manual' },
    });
    return NextResponse.json({ interview }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
