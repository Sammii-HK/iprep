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
import { randomBytes } from 'crypto';
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
  /**
   * A random UUID the app generates once per installation. It identifies the installation only (never a person,
   * never hardware). Absent for older clients: see `getOrCreateDevice`.
   */
  installId?: string | null;
}

const INSTALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The canonical form of an installation id, or null when it is missing or malformed. */
export function normaliseInstallId(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v && INSTALL_ID.test(v) ? v : null;
}

/** Always creates a Device (no installation identity). Kept for operator tooling and tests. */
export async function createDevice(db: Db, userId: string, info: DeviceInfo): Promise<{ id: string }> {
  return db.device.create({
    data: { userId, platform: info.platform.slice(0, 32), appVersion: info.appVersion?.slice(0, 64) ?? null, lastSeenAt: new Date() },
    select: { id: true },
  });
}

/**
 * One user + one app installation = one Device.
 *
 *  - With an installation id: the (user, installation) Device is reused. A Device that the user signed out of
 *    ('user-logout') is brought back instead of leaving a dead row behind and starting another. A Device revoked
 *    for any other reason (refresh-token reuse, Apple revocation, deletion, operator) stays revoked and a fresh
 *    row is created, so revocation is never undone by signing in again.
 *  - The database decides: a partial unique index allows one ACTIVE row per (user, installation), and the insert
 *    is an atomic INSERT ... ON CONFLICT, so concurrent sign-ins converge on one row instead of racing.
 *  - The installation id is scoped by user. The same id under another account is a different Device, and one
 *    account can never reach another account's Device through it.
 *  - Without an installation id (a client that predates it): every sign-in creates a Device, as before.
 *
 * Reusing a Device adds a refresh-token family beside any existing one; earlier tokens are not revoked here, so a
 * response that is lost in flight cannot lock the installation out. Refresh-token reuse detection still revokes
 * the Device.
 */
export async function getOrCreateDevice(db: Db, userId: string, info: DeviceInfo): Promise<{ id: string }> {
  const installId = normaliseInstallId(info.installId);
  if (!installId) return createDevice(db, userId, info);
  const platform = info.platform.slice(0, 32);
  const appVersion = info.appVersion?.slice(0, 64) ?? null;

  const revived = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE "Device"
       SET "revokedAt" = NULL, "revokedReason" = NULL, "lastSeenAt" = now(), "platform" = ${platform}, "appVersion" = ${appVersion}
     WHERE id = (
       SELECT d.id FROM "Device" d
        WHERE d."userId" = ${userId} AND d."installId" = ${installId}
          AND d."revokedAt" IS NOT NULL AND d."revokedReason" = 'user-logout'
          AND NOT EXISTS (SELECT 1 FROM "Device" a WHERE a."userId" = ${userId} AND a."installId" = ${installId} AND a."revokedAt" IS NULL)
        ORDER BY d."createdAt" DESC LIMIT 1)
    RETURNING id`;
  if (revived[0]) return revived[0];

  const rows = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "Device" ("id", "userId", "platform", "appVersion", "installId", "lastSeenAt", "createdAt")
    VALUES (${`c${randomBytes(12).toString('hex')}`}, ${userId}, ${platform}, ${appVersion}, ${installId}, now(), now())
    ON CONFLICT ("userId", "installId") WHERE "installId" IS NOT NULL AND "revokedAt" IS NULL
    DO UPDATE SET "lastSeenAt" = now(), "platform" = EXCLUDED."platform", "appVersion" = EXCLUDED."appVersion"
    RETURNING id`;
  return rows[0];
}

/**
 * Attach an installation id to an existing Device that has none (a session from before installation ids existed),
 * so the next sign-in on this installation reuses it. Best effort, and only ever fills a NULL: it never moves or
 * overwrites an id, and does nothing if the user already has another active Device for that installation.
 */
export async function bindInstallIdToDevice(db: Db, deviceId: string, rawInstallId: string | null | undefined): Promise<boolean> {
  const installId = normaliseInstallId(rawInstallId);
  if (!installId) return false;
  const n = await db.$executeRaw`
    UPDATE "Device" SET "installId" = ${installId}
     WHERE id = ${deviceId} AND "installId" IS NULL AND "revokedAt" IS NULL
       AND NOT EXISTS (SELECT 1 FROM "Device" o WHERE o."userId" = "Device"."userId" AND o."installId" = ${installId} AND o."revokedAt" IS NULL)`;
  return n === 1;
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
