import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getConfig } from '@/lib/config';
import { clientIp, enforceRateLimit } from '@/lib/rate-limit';
import { rotateRefreshToken } from '@/lib/native/session';
import { nativeError, readJson } from '@/lib/native/http';

const Body = z.object({ refreshToken: z.string().min(20).max(256) }).strict();

/** Each refresh token works once. A rotated token presented again revokes the device (TOKEN_REUSED). */
export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit({ key: `native-refresh:ip:${clientIp(request)}`, limit: 60, windowMs: 15 * 60_000 });
    const { refreshToken } = Body.parse(await readJson(request, 4_000));
    const tokens = await rotateRefreshToken(prisma, refreshToken, getConfig().jwt.secret);
    return NextResponse.json(tokens, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return nativeError(error);
  }
}
