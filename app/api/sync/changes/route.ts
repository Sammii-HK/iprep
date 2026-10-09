import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireDevice } from '@/lib/native/auth';
import { nativeError } from '@/lib/native/http';
import { enforceRateLimit } from '@/lib/rate-limit';
import { pullChanges } from '@/lib/sync/pull';

/** Pull this learner's changes since an opaque cursor. See docs/P2_NATIVE_SYNC.md section 2.6. */
export async function GET(request: NextRequest) {
  try {
    const { learnerId, device } = await requireDevice(request);
    await enforceRateLimit({ key: `sync-changes:device:${device.id}`, limit: 120, windowMs: 60_000 });
    const params = request.nextUrl.searchParams;
    const limit = Number(params.get('limit') ?? '');
    const result = await pullChanges(prisma, learnerId, {
      cursor: params.get('cursor') || null,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    });
    // Record where this device has got to (diagnostics only; the cursor itself lives on the device).
    await prisma.device.update({ where: { id: device.id }, data: { lastCursor: result.nextCursor } }).catch(() => undefined);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return nativeError(error);
  }
}
