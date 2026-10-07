import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getConfig } from '@/lib/config';
import { clientIp, enforceRateLimit } from '@/lib/rate-limit';
import { verifyAppleIdentityToken } from '@/lib/native/apple';
import { signInWithApple } from '@/lib/native/signin';
import { assertClientSupported } from '@/lib/native/auth';
import { nativeError, readJson } from '@/lib/native/http';

const Body = z
  .object({
    identityToken: z.string().min(20).max(8000),
    nonce: z.string().min(8).max(256),
    inviteCode: z.string().min(4).max(64).optional(),
    linkCode: z.string().min(4).max(64).optional(),
    cancelDeletion: z.boolean().optional(),
    device: z.object({ platform: z.string().min(1).max(32), appVersion: z.string().max(64).optional() }),
  })
  .strict();

/** Exchange a verified Apple identity for native tokens. See docs/P2_NATIVE_SYNC.md section 2.1. */
export async function POST(request: NextRequest) {
  try {
    assertClientSupported(request);
    await enforceRateLimit({ key: `native-auth:ip:${clientIp(request)}`, limit: 20, windowMs: 15 * 60_000 });
    const body = Body.parse(await readJson(request, 40_000));
    const result = await signInWithApple(
      {
        db: prisma,
        verify: (token, nonce) => verifyAppleIdentityToken(token, nonce),
        secret: getConfig().jwt.secret,
        limit: (key, limit, windowMs) => enforceRateLimit({ key, limit, windowMs }),
      },
      body
    );
    return NextResponse.json(
      {
        ...result.tokens,
        device: { id: result.deviceId },
        user: { id: result.userId },
        learner: { id: result.learnerId },
      },
      { status: result.status, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return nativeError(error);
  }
}
