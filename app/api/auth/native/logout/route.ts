import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireDevice } from '@/lib/native/auth';
import { revokeDevice } from '@/lib/native/session';
import { nativeError } from '@/lib/native/http';

/** Revoke this device and every refresh token it holds. Local data and the pending queue are the app's to keep. */
export async function POST(request: NextRequest) {
  try {
    const { device } = await requireDevice(request);
    await revokeDevice(prisma, device.id, 'user-logout');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return nativeError(error);
  }
}
