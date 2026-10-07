import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { clientIp, enforceRateLimit } from '@/lib/rate-limit';
import { AppleVerificationError, verifyAppleServerNotification } from '@/lib/native/apple';
import { applyAppleServerEvent } from '@/lib/native/notifications';
import { AppError } from '@/lib/errors';
import { nativeError } from '@/lib/native/http';

/**
 * Apple server-to-server notifications (consent revoked, account deleted). Apple posts `{ "payload": "<JWT>" }`.
 * The JWT is verified against Apple's keys exactly like an identity token. Not enabled until the endpoint URL is
 * configured in the Apple Developer account (docs/P2_NATIVE_SYNC.md, manual actions).
 */
export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit({ key: `apple-s2s:ip:${clientIp(request)}`, limit: 120, windowMs: 60_000 });
    const body = (await request.json().catch(() => null)) as { payload?: unknown } | null;
    if (!body || typeof body.payload !== 'string' || body.payload.length > 20_000) {
      throw new AppError('Invalid notification', 400, 'INVALID_NOTIFICATION');
    }
    let event;
    try {
      event = await verifyAppleServerNotification(body.payload);
    } catch (e) {
      if (e instanceof AppleVerificationError) throw new AppError('Invalid notification', 400, 'INVALID_NOTIFICATION');
      throw e;
    }
    await applyAppleServerEvent(prisma, event);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return nativeError(error);
  }
}
