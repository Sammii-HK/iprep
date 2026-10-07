import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireDevice } from '@/lib/native/auth';
import { nativeError } from '@/lib/native/http';
import { enforceRateLimit } from '@/lib/rate-limit';
import { isPremiumUser } from '@/lib/premium';

/** How long a device may cache the answer. Re-derived from the account on every call, so revocation takes effect at the next refresh. */
const TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * What the signed-in native device may unlock in the product (entitlement only; never a security or abuse bypass).
 *
 * `unlimited` is derived on the server from the stored account (ADMIN role or the premium flag), exactly as the web
 * app decides premium. The client cannot set it, and the role and email are never returned. Rate limits, consent
 * and the authentication boundary are unchanged by it.
 */
export async function GET(request: NextRequest) {
  try {
    const { user, device } = await requireDevice(request);
    await enforceRateLimit({ key: `native-capabilities:device:${device.id}`, limit: 60, windowMs: 60_000 });
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { role: true, email: true, isPremium: true },
    });
    return NextResponse.json(
      { productAccess: { unlimited: isPremiumUser(row) }, ttlSeconds: TTL_SECONDS },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return nativeError(error);
  }
}
