import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getConfig } from '@/lib/config';
import { clientIp, enforceRateLimit } from '@/lib/rate-limit';
import { bindInstallIdToDevice, rotateRefreshToken } from '@/lib/native/session';
import { verifyNativeAccessToken } from '@/lib/native/tokens';
import { nativeError, readJson } from '@/lib/native/http';

const Body = z.object({ refreshToken: z.string().min(20).max(256) }).strict();

/** Each refresh token works once. A rotated token presented again revokes the device (TOKEN_REUSED). */
export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit({ key: `native-refresh:ip:${clientIp(request)}`, limit: 60, windowMs: 15 * 60_000 });
    const { refreshToken } = Body.parse(await readJson(request, 4_000));
    const secret = getConfig().jwt.secret;
    const tokens = await rotateRefreshToken(prisma, refreshToken, secret);

    // A session that began before installation ids existed adopts the app's id on its first refresh, so the next
    // sign-in on this installation reuses this Device. Only fills a missing id, and a failure never blocks a refresh.
    const installId = request.headers.get('x-iprep-install-id');
    if (installId) {
      const claims = verifyNativeAccessToken(tokens.accessToken, secret);
      if (claims) await bindInstallIdToDevice(prisma, claims.deviceId, installId).catch(() => undefined);
    }

    return NextResponse.json(tokens, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return nativeError(error);
  }
}
