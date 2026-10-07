/**
 * Account purge: the exceptional, owner-level procedure that removes a deleted account's personal data.
 *
 * The runtime role cannot do this on purpose (the ledger is append-only for it). This runs with the schema owner's
 * credential inside ONE transaction that opts in to maintenance (`SET LOCAL iprep.ledger_maintenance = 'on'`, which
 * the append-only triggers honour only for that transaction). It is guarded by the 30-day grace period: an account
 * is purgeable only when deletionRequestedAt is set and purgeAfter has passed.
 *
 * What is removed: every row that can identify or reproduce the learner: attempts, evidence (transcripts), prompt
 * snapshots, evaluations and measurements, the legacy session items and quiz attempts, sessions, banks and questions
 * they own (and their revisions), progress and insights, goals, interviews, folders, machine principals acting for
 * them, devices, tokens, identities, link codes, invite redemptions, sync log and feed rows, rate-limit buckets keyed
 * by their id, the learner and the user. What remains: an AccountDeletionReceipt holding only row counts.
 * Audio objects in R2 cannot be deleted from SQL: their keys are returned so the caller can delete them.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../errors';

export interface PurgeOutcome {
  userId: string;
  counts: Record<string, number>;
  audioKeys: string[];
}

export class PurgeRefusedError extends AppError {
  constructor(message: string, code: string) {
    super(message, 409, code);
    this.name = 'PurgeRefusedError';
  }
}

/** R2 object keys always start with "audio/". Works for endpoint URLs, public-domain URLs and bare keys. */
export function audioKeyFromRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const m = ref.match(/(?:^|\/)(audio\/[^?#]+)$/);
  return m ? m[1] : null;
}

export async function dueForPurge(db: PrismaClient, now: Date = new Date()): Promise<string[]> {
  const rows = await db.user.findMany({
    where: { deletionRequestedAt: { not: null }, purgeAfter: { lte: now } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function purgeAccount(db: PrismaClient, userId: string, now: Date = new Date()): Promise<PurgeOutcome> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { deletionRequestedAt: true, purgeAfter: true } });
  if (!user) throw new PurgeRefusedError('No such user', 'PURGE_NO_SUCH_USER');
  if (!user.deletionRequestedAt || !user.purgeAfter) throw new PurgeRefusedError('Deletion was not requested for this account', 'PURGE_NOT_REQUESTED');
  if (user.purgeAfter > now) throw new PurgeRefusedError('The grace period has not ended', 'PURGE_GRACE_PERIOD');

  const priv = await db.$queryRaw<Array<{ can: boolean }>>`SELECT has_table_privilege(current_user, '"Attempt"', 'DELETE') AS can`;
  if (!priv[0]?.can) throw new PurgeRefusedError('This connection cannot delete ledger rows: use the owner credential', 'PURGE_NEEDS_OWNER');

  return db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL iprep.ledger_maintenance = 'on'`);
      const counts: Record<string, number> = {};
      const del = async (name: string, op: Promise<{ count: number }>) => {
        counts[name] = (await op).count;
      };

      const learner = await tx.learner.findUnique({ where: { userId }, select: { id: true } });
      const learnerId = learner?.id ?? null;

      // Audio keys first (before the rows that reference them disappear).
      const refs = await collectAudioRefs(tx, userId, learnerId);
      const audioKeys = [...new Set(refs.map(audioKeyFromRef).filter((k): k is string => !!k))];

      if (learnerId) {
        await del('syncEventLog', tx.syncEventLog.deleteMany({ where: { learnerId } }));
        await del('syncChange', tx.syncChange.deleteMany({ where: { learnerId } }));
        await del('attemptMeasurement', tx.attemptMeasurement.deleteMany({ where: { attempt: { learnerId } } }));
        await del('attemptEvaluation', tx.attemptEvaluation.deleteMany({ where: { attempt: { learnerId } } }));
        await del('attemptEvidence', tx.attemptEvidence.deleteMany({ where: { attempt: { learnerId } } }));
      }
      // Legacy projections (transcripts also live here).
      await del('sessionItem', tx.sessionItem.deleteMany({ where: { OR: [{ session: { userId } }, ...(learnerId ? [{ attempt: { learnerId } }] : [])] } }));
      await del('quizAttempt', tx.quizAttempt.deleteMany({ where: { quiz: { userId } } }));
      if (learnerId) {
        await del('attempt', tx.attempt.deleteMany({ where: { learnerId } }));
        await del('goal', tx.goal.deleteMany({ where: { learnerId } }));
      }
      await del('learningSummary', tx.learningSummary.deleteMany({ where: { userId } }));
      await del('userLearningInsight', tx.userLearningInsight.deleteMany({ where: { userId } }));
      await del('userQuestionProgress', tx.userQuestionProgress.deleteMany({ where: { userId } }));
      await del('session', tx.session.deleteMany({ where: { userId } }));
      await del('quiz', tx.quiz.deleteMany({ where: { userId } }));
      await del('bankFolder', tx.bankFolder.deleteMany({ where: { userId } }));
      await del('question', tx.question.deleteMany({ where: { bank: { userId } } }));
      await del('questionBank', tx.questionBank.deleteMany({ where: { userId } }));
      await del('interview', tx.interview.deleteMany({ where: { userId } }));
      await del('machinePrincipal', tx.machinePrincipal.deleteMany({ where: { userId } }));
      await del('refreshToken', tx.nativeRefreshToken.deleteMany({ where: { device: { userId } } }));
      await del('device', tx.device.deleteMany({ where: { userId } }));
      await del('authIdentity', tx.authIdentity.deleteMany({ where: { userId } }));
      await del('accountLinkCode', tx.accountLinkCode.deleteMany({ where: { userId } }));
      await tx.nativeInvite.updateMany({ where: { usedByUserId: userId }, data: { usedByUserId: null } });
      counts.rateLimitBucket = Number(
        await tx.$executeRaw`DELETE FROM "RateLimitBucket" WHERE position(${userId} in "key") > 0`
      );
      if (learnerId) await del('learner', tx.learner.deleteMany({ where: { id: learnerId } }));
      await del('user', tx.user.deleteMany({ where: { id: userId } }));

      await tx.accountDeletionReceipt.create({
        data: { requestedAt: user.deletionRequestedAt!, counts: { ...counts, audioObjects: audioKeys.length } },
      });
      return { userId, counts, audioKeys };
    },
    { timeout: 120_000, maxWait: 30_000 }
  );
}

async function collectAudioRefs(tx: Prisma.TransactionClient, userId: string, learnerId: string | null): Promise<string[]> {
  const items = await tx.sessionItem.findMany({ where: { session: { userId }, audioUrl: { not: null } }, select: { audioUrl: true } });
  const quiz = await tx.quizAttempt.findMany({ where: { quiz: { userId }, audioUrl: { not: null } }, select: { audioUrl: true } });
  const ev = learnerId
    ? await tx.attemptEvidence.findMany({ where: { attempt: { learnerId }, audioRef: { not: null } }, select: { audioRef: true } })
    : [];
  return [...items.map((i) => i.audioUrl!), ...quiz.map((q) => q.audioUrl!), ...ev.map((e) => e.audioRef!)];
}
