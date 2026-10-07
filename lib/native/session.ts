/**
 * Native device sessions: devices, rotating refresh tokens and revocation.
 *
 * Refresh-token rules (the family is the device):
 *  - every refresh token works once; using it atomically marks it rotated and mints its successor;
 *  - presenting a token that was already rotated is REUSE: the whole device is revoked, because either the
 *    token leaked or two copies exist, and the server cannot tell which one is the legitimate holder;
 *  - the atomic flip (UPDATE ... WHERE rotatedAt IS NULL) means two concurrent requests with the same token
 *    cannot both succeed.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../errors';
import { ACCESS_TTL_SECONDS, REFRESH_TTL_MS, generateRefreshToken, hashToken, signNativeAccessToken } from './tokens';

type Db = PrismaClient | Prisma.TransactionClient;

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface DeviceInfo {
  platform: string;
  appVersion?: string | null;
}

export async function createDevice(db: Db, userId: string, info: DeviceInfo): Promise<{ id: string }> {
  return db.device.create({
    data: { userId, platform: info.platform.slice(0, 32), appVersion: info.appVersion?.slice(0, 64) ?? null, lastSeenAt: new Date() },
    select: { id: true },
  });
}

export async function issueTokens(
  db: Db,
  args: { userId: string; deviceId: string; secret: string; predecessorId?: string }
): Promise<IssuedTokens> {
  const refreshToken = generateRefreshToken();
  const row = await db.nativeRefreshToken.create({
    data: {
      deviceId: args.deviceId,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
    select: { id: true },
  });
  if (args.predecessorId) {
    await db.nativeRefreshToken.update({ where: { id: args.predecessorId }, data: { replacedById: row.id } });
  }
  return {
    accessToken: signNativeAccessToken({ userId: args.userId, deviceId: args.deviceId }, args.secret),
    refreshToken,
    expiresIn: ACCESS_TTL_SECONDS,
  };
}

export async function revokeDevice(db: Db, deviceId: string, reason: string): Promise<void> {
  const now = new Date();
  await db.device.updateMany({ where: { id: deviceId, revokedAt: null }, data: { revokedAt: now, revokedReason: reason } });
  await db.nativeRefreshToken.updateMany({ where: { deviceId, revokedAt: null }, data: { revokedAt: now } });
}

export async function revokeAllDevices(db: Db, userId: string, reason: string): Promise<number> {
  const devices = await db.device.findMany({ where: { userId, revokedAt: null }, select: { id: true } });
  for (const d of devices) await revokeDevice(db, d.id, reason);
  return devices.length;
}

/** Rotate a refresh token. Throws AppError(401, INVALID_TOKEN | TOKEN_REUSED). */
export async function rotateRefreshToken(db: PrismaClient, presented: string, secret: string): Promise<IssuedTokens> {
  const tokenHash = hashToken(presented);
  const now = new Date();

  // Atomic claim: only one concurrent caller can flip a live token to rotated.
  const claimed = await db.nativeRefreshToken.updateMany({
    where: { tokenHash, rotatedAt: null, revokedAt: null, expiresAt: { gt: now } },
    data: { rotatedAt: now },
  });

  if (claimed.count !== 1) {
    const known = await db.nativeRefreshToken.findUnique({ where: { tokenHash }, select: { deviceId: true, rotatedAt: true } });
    if (known?.rotatedAt) {
      await revokeDevice(db, known.deviceId, 'refresh-reuse');
      throw new AppError('Session no longer valid', 401, 'TOKEN_REUSED');
    }
    throw new AppError('Invalid token', 401, 'INVALID_TOKEN');
  }

  const old = await db.nativeRefreshToken.findUniqueOrThrow({
    where: { tokenHash },
    select: { id: true, deviceId: true, device: { select: { userId: true, revokedAt: true, user: { select: { deletionRequestedAt: true } } } } },
  });
  if (old.device.revokedAt || old.device.user.deletionRequestedAt) {
    throw new AppError('Invalid token', 401, 'INVALID_TOKEN');
  }
  return issueTokens(db, { userId: old.device.userId, deviceId: old.deviceId, secret, predecessorId: old.id });
}
