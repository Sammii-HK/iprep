import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { SyncPayloadSchema, planSync } from '@/lib/interviews';
import { enforceRateLimit, errorResponse, parseJson } from '@/lib/interviews-api';

/**
 * Machine route (the Notion sync). Accepts a signed-in learner, or a machine principal holding the
 * interviews:sync scope (Authorization: Bearer ipm_...). The principal acts as its own learner and is never admin.
 * Upserts by (user, source, externalId).
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAccess(request, 'interviews:sync');
    await enforceRateLimit(request, user.id);
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
