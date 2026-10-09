import type { PrismaClient } from '@prisma/client';
import type { AppleServerEvent } from './apple';
import { revokeAllDevices } from './session';

/**
 * consent-revoked: the user removed iPrep from their Apple ID. The identity is revoked (reinstatable by signing in
 * again, which proves control) and every device is signed out. Local data and the learner's history are untouched.
 * account-delete: the Apple account itself was deleted. The identity is revoked until an operator reinstates it.
 * email-*: informational, ignored.
 */
export async function applyAppleServerEvent(db: PrismaClient, event: AppleServerEvent): Promise<'revoked' | 'ignored' | 'unknown-subject'> {
  if (event.type !== 'consent-revoked' && event.type !== 'account-delete') return 'ignored';
  const identity = await db.authIdentity.findUnique({
    where: { provider_subject: { provider: 'apple', subject: event.subject } },
    select: { id: true, userId: true, revokedAt: true },
  });
  if (!identity) return 'unknown-subject';
  const reason = event.type === 'account-delete' ? 'account-deleted' : 'consent-revoked';
  await db.$transaction(async (tx) => {
    await tx.authIdentity.update({
      where: { id: identity.id },
      // An earlier account-deleted must not be softened by a later consent-revoked.
      data: identity.revokedAt && reason === 'consent-revoked' ? {} : { revokedAt: identity.revokedAt ?? new Date(), revokedReason: reason },
    });
    await revokeAllDevices(tx, identity.userId, 'apple-revoked');
  });
  return 'revoked';
}
