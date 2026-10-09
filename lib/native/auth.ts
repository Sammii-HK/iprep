/**
 * The one place native access tokens are interpreted. Routes call requireDevice(); nothing else reads the
 * Authorization header for native clients.
 *
 * A device token resolves User -> Learner on the server. The client never says which learner it is. Machine
 * principals, web cookies and web JWTs are all refused here, and native tokens are refused by the web helpers
 * (different signing key and audience).
 */
import type { NextRequest } from 'next/server';
import { prisma } from '../db';
import { getConfig } from '../config';
import { AppError } from '../errors';
import { ensureLearner } from '../learner';
import { isMachineToken } from '../machine-auth';
import { verifyNativeAccessToken } from './tokens';

export interface DeviceContext {
  user: { id: string; email: string | null };
  learnerId: string;
  device: { id: string };
}

export function minClientBuild(): number {
  const n = Number(process.env.NATIVE_MIN_CLIENT_BUILD ?? '0');
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** "ios/1.4.0 (123)" -> 123. Missing or unparseable is build 0 (only refused when a minimum is configured). */
export function clientBuild(header: string | null): number {
  const m = header?.match(/\((\d+)\)/);
  return m ? Number(m[1]) : 0;
}

export function assertClientSupported(request: NextRequest): void {
  const min = minClientBuild();
  if (min > 0 && clientBuild(request.headers.get('x-iprep-client')) < min) {
    throw new AppError('Please update the app to keep syncing', 426, 'CLIENT_TOO_OLD');
  }
}

function bearer(request: NextRequest): string | null {
  const match = request.headers.get('authorization')?.trim().match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export async function requireDevice(request: NextRequest): Promise<DeviceContext> {
  const token = bearer(request);
  if (!token || isMachineToken(token)) throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  const claims = verifyNativeAccessToken(token, getConfig().jwt.secret);
  if (!claims) throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');

  const device = await prisma.device.findUnique({
    where: { id: claims.deviceId },
    select: { id: true, userId: true, revokedAt: true, lastSeenAt: true, user: { select: { id: true, email: true, deletionRequestedAt: true, purgeAfter: true } } },
  });
  if (!device || device.revokedAt || device.userId !== claims.userId) {
    throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  }
  if (device.user.deletionRequestedAt) {
    throw new AppError('This account is scheduled for deletion', 403, 'ACCOUNT_DELETION_PENDING', {
      purgeAfter: device.user.purgeAfter?.toISOString() ?? null,
    });
  }
  assertClientSupported(request);

  const now = Date.now();
  if (!device.lastSeenAt || now - device.lastSeenAt.getTime() > 60_000) {
    await prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date(now) } }).catch(() => undefined);
  }
  const learner = await ensureLearner(device.user.id, prisma);
  return { user: { id: device.user.id, email: device.user.email }, learnerId: learner.id, device: { id: device.id } };
}
