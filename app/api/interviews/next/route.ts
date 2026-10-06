import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { notFactsBank } from '@/lib/fact-sheet';
import { matchFolderForCompany, pickNextInterview } from '@/lib/interviews';
import { enforceRateLimit, errorResponse } from '@/lib/interviews-api';

/**
 * The single next interview, with its prep folder and the banks in it so a
 * client can prioritise. Folder resolution: the stored folderId, falling back
 * to a "<Company> ... Interview Prep" title match.
 */
export async function GET(request: NextRequest) {
  try {
    await enforceRateLimit(request);
    const user = await requireAuth(request);
    const now = new Date();

    const candidates = await prisma.interview.findMany({
      where: { userId: user.id, status: 'scheduled', startsAt: { gte: new Date(now.getTime() - 24 * 3600000) } },
      orderBy: { startsAt: 'asc' },
      take: 25,
    });
    const interview = pickNextInterview(candidates, now);
    if (!interview) return NextResponse.json({ interview: null, folder: null });

    const folders = await prisma.bankFolder.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        title: true,
        items: {
          where: { bank: notFactsBank },
          orderBy: { order: 'asc' },
          select: { bank: { select: { id: true, title: true, _count: { select: { questions: true } } } } },
        },
      },
    });
    const folder =
      folders.find((f) => f.id === interview.folderId) ?? matchFolderForCompany(interview.company, folders);

    return NextResponse.json({
      interview,
      folder: folder
        ? {
            id: folder.id,
            title: folder.title,
            banks: folder.items.map((item) => ({
              id: item.bank.id,
              title: item.bank.title,
              questionCount: item.bank._count.questions,
            })),
          }
        : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
