import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireDevice } from '@/lib/native/auth';
import { nativeError, readJson } from '@/lib/native/http';
import { enforceRateLimit } from '@/lib/rate-limit';
import { MAX_BATCH, processBatch } from '@/lib/sync/events';
import { AppError } from '@/lib/errors';

const Body = z.object({ deviceClockAtSend: z.string().datetime({ offset: true }).optional(), events: z.array(z.unknown()).min(1).max(MAX_BATCH) });

/** Push client-created learning events. See docs/P2_NATIVE_SYNC.md section 2.5. */
export async function POST(request: NextRequest) {
  try {
    const { user, learnerId, device } = await requireDevice(request);
    await enforceRateLimit({ key: `sync-events:device:${device.id}`, limit: 60, windowMs: 60_000 });
    const parsed = Body.safeParse(await readJson(request, 2_000_000));
    if (!parsed.success) throw new AppError(`A batch holds 1 to ${MAX_BATCH} events`, 400, 'INVALID_BATCH');
    const receivedAt = new Date();
    const results = await processBatch(
      prisma,
      { userId: user.id, learnerId, deviceId: device.id },
      parsed.data.events,
      { receivedAt, deviceClockAtSend: parsed.data.deviceClockAtSend ? new Date(parsed.data.deviceClockAtSend) : null }
    );
    await prisma.device.update({ where: { id: device.id }, data: { lastPushAt: receivedAt } }).catch(() => undefined);
    return NextResponse.json({ results, serverTime: receivedAt.toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return nativeError(error);
  }
}
