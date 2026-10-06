import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { CreateInterviewSchema, isUpcoming, sortInterviews } from '@/lib/interviews';
import { assertFolderOwned, enforceRateLimit, errorResponse, parseJson } from '@/lib/interviews-api';

export async function GET(request: NextRequest) {
  try {
    await enforceRateLimit(request);
    const user = await requireAuth(request);
    const includePast = request.nextUrl.searchParams.get('includePast') === 'true';
    const now = new Date();

    const all = await prisma.interview.findMany({
      where: { userId: user.id },
      orderBy: { startsAt: 'asc' },
    });
    const sorted = sortInterviews(all, now);
    const interviews = includePast
      ? sorted
      : sorted.filter((i) => i.status !== 'cancelled' && isUpcoming(i, now));

    return NextResponse.json({ interviews });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit(request);
    const user = await requireAuth(request);
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
