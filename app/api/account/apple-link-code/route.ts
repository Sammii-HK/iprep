import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { createLinkCode } from '@/lib/native/account';
import { nativeError } from '@/lib/native/http';

/** A signed-in web user creates a one-time code to link their Apple identity from the app. Never by email. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    await enforceRateLimit({ key: `link-code:user:${user.id}`, limit: 10, windowMs: 60 * 60_000 });
    const { code, expiresAt } = await createLinkCode(prisma, user.id);
    return NextResponse.json({ code, expiresAt: expiresAt.toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return nativeError(error);
  }
}
