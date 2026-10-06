import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { SyncPayloadSchema, planSync } from '@/lib/interviews';
import { enforceRateLimit, errorResponse, parseJson } from '@/lib/interviews-api';

/**
 * Machine route. Authenticated by requireAuth, which accepts the existing
 * x-internal-key header (IPREP_INTERNAL_KEY), exactly as /api/banks does.
 * Upserts by (user, source, externalId).
 */
export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit(request);
    const user = await requireAuth(request);
    const { source, complete, interviews } = SyncPayloadSchema.parse(await parseJson(request));

    const existing = await prisma.interview.findMany({
      where: { userId: user.id, source },
      select: { id: true, externalId: true, status: true, startsAt: true },
    });
    const plan = planSync(existing, interviews, complete, new Date());

    await prisma.$transaction([
      ...plan.create.map((item) => prisma.interview.create({ data: { ...item, userId: user.id, source } })),
      ...plan.update.map((u) => prisma.interview.update({ where: { id: u.id }, data: u.data })),
      ...(plan.cancel.length
        ? [prisma.interview.updateMany({ where: { id: { in: plan.cancel }, userId: user.id }, data: { status: 'cancelled' } })]
        : []),
    ]);

    return NextResponse.json({
      created: plan.create.length,
      updated: plan.update.length,
      cancelled: plan.cancel.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
