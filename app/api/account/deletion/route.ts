import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { requireDevice } from '@/lib/native/auth';
import { requestAccountDeletion } from '@/lib/native/account';
import { enforceRateLimit } from '@/lib/rate-limit';
import { isMachineToken } from '@/lib/machine-auth';
import { nativeError } from '@/lib/native/http';

/**
 * Request account deletion (web session or native device). The account becomes DELETION_PENDING, every native
 * device is revoked now, and the guarded purge may run after `purgeAfter` (30 days). Machine credentials cannot.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
    let userId: string;
    if (auth && !isMachineToken(auth) && !request.cookies.get('auth-token')) {
      userId = (await requireDevice(request)).user.id;
    } else {
      userId = (await requireAuth(request)).id;
    }
    await enforceRateLimit({ key: `account-deletion:user:${userId}`, limit: 5, windowMs: 60 * 60_000 });
    const result = await requestAccountDeletion(prisma, userId);
    return NextResponse.json({ state: result.state, purgeAfter: result.purgeAfter.toISOString() });
  } catch (error) {
    return nativeError(error);
  }
}
