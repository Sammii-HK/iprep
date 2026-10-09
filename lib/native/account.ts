/** Account operations for native sync: link codes and the deletion lifecycle (request side). */
import type { PrismaClient } from '@prisma/client';
import { generateLinkCode, hashCode } from './codes';
import { revokeAllDevices } from './session';

export const LINK_CODE_TTL_MS = 10 * 60_000;
export const DELETION_GRACE_DAYS = 30;

export async function createLinkCode(db: PrismaClient, userId: string, now: Date = new Date()): Promise<{ code: string; expiresAt: Date }> {
  const code = generateLinkCode();
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
  // One live code per user: creating a new one retires the previous unused ones.
  await db.accountLinkCode.updateMany({ where: { userId, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
  await db.accountLinkCode.create({ data: { userId, codeHash: hashCode(code), expiresAt } });
  return { code, expiresAt };
}

/**
 * Request deletion: the account becomes DELETION_PENDING, every native device is revoked now, and learning writes
 * stop (requireAuth, requireDevice and machine access all refuse a pending account). Idempotent: asking again
 * does not extend the date. The purge itself is an exceptional owner-level procedure (scripts/purge-accounts.ts).
 */
export async function requestAccountDeletion(
  db: PrismaClient,
  userId: string,
  now: Date = new Date()
): Promise<{ state: 'DELETION_PENDING'; purgeAfter: Date }> {
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { deletionRequestedAt: true, purgeAfter: true } });
    const purgeAfter = user.purgeAfter ?? new Date(now.getTime() + DELETION_GRACE_DAYS * 86_400_000);
    if (!user.deletionRequestedAt) {
      await tx.user.update({ where: { id: userId }, data: { deletionRequestedAt: now, purgeAfter } });
    }
    await revokeAllDevices(tx, userId, 'deletion-requested');
    return { state: 'DELETION_PENDING' as const, purgeAfter };
  });
}
