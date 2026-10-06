/**
 * Learner identity.
 *
 * A User is an account (credentials, role, billing flags). A Learner is the stable owner of learning evidence.
 * Today they are 1:1; keeping them apart means a later AuthIdentity split moves credentials without touching a
 * single Attempt. A machine principal is neither: it acts on behalf of a learner and is recorded on the attempt
 * as the actor, never as the learner.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/** The learner for a user, created on first use. Race-safe (a unique index plus an upsert). */
export async function ensureLearner(userId: string, db: Db): Promise<{ id: string }> {
  return db.learner.upsert({
    where: { userId },
    update: {},
    create: { userId },
    select: { id: true },
  });
}

export interface LearnerActor {
  learnerId: string;
  /** Set when a machine principal recorded the evidence on the learner's behalf. */
  actorPrincipalId: string | null;
}

/**
 * Who an access context writes evidence for. A human acts as their own learner. A machine principal acts as the
 * learner it is explicitly bound to; it never becomes one and never inherits one through its user (so an admin
 * user's learner is not reachable by a principal bound elsewhere, whatever the user's role).
 */
export async function resolveLearnerActor(
  ctx: { user: { id: string }; principal?: { id: string; learnerId: string } },
  db: Db
): Promise<LearnerActor> {
  if (ctx.principal) {
    if (!ctx.principal.learnerId) throw new Error('A machine principal must be bound to a learner.');
    return { learnerId: ctx.principal.learnerId, actorPrincipalId: ctx.principal.id };
  }
  return { learnerId: (await ensureLearner(ctx.user.id, db)).id, actorPrincipalId: null };
}
