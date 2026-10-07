/**
 * Sign in with Apple, as a state machine over (Apple subject, invite code, link code).
 *
 *   known active identity  -> sign in (invite and link codes are ignored, never consumed)
 *   known revoked identity -> reinstated if the user revoked it; refused if the account was deleted at Apple
 *   unknown + link code    -> link to the signed-in web user who created the code (never by email)
 *   unknown + invite code  -> create User + Learner + identity, redeeming the invite in the SAME transaction
 *   unknown, nothing valid -> 403 INVITE_REQUIRED (one generic answer for missing/invalid/expired/used)
 *
 * Authentication proves who is acting. The Learner is always derived from the User on the server.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError, ValidationError } from '../errors';
import { type AppleIdentity, AppleVerificationError } from './apple';
import { hashCode } from './codes';
import { createDevice, issueTokens, type DeviceInfo, type IssuedTokens } from './session';
import { sha256Hex } from './apple';

export interface SignInInput {
  identityToken: string;
  nonce: string;
  inviteCode?: string;
  linkCode?: string;
  cancelDeletion?: boolean;
  device: DeviceInfo;
}

export interface SignInDeps {
  db: PrismaClient;
  verify: (identityToken: string, nonce: string) => Promise<AppleIdentity>;
  secret: string;
  /** Throws RateLimitError when the key is over its limit. */
  limit: (key: string, limit: number, windowMs: number) => Promise<void>;
  now?: () => Date;
}

export interface SignInResult {
  status: 200 | 201;
  tokens: IssuedTokens;
  deviceId: string;
  userId: string;
  learnerId: string;
}

const PROVIDER = 'apple';
const INVITE_REQUIRED = () => new AppError('An invitation is required', 403, 'INVITE_REQUIRED');

export async function signInWithApple(deps: SignInDeps, input: SignInInput): Promise<SignInResult> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  if (input.inviteCode && input.linkCode) throw new ValidationError('Send an invite code or a link code, not both');

  let apple: AppleIdentity;
  try {
    apple = await deps.verify(input.identityToken, input.nonce);
  } catch (e) {
    if (e instanceof AppleVerificationError) throw new AppError('Apple sign-in could not be verified', 400, 'INVALID_APPLE_TOKEN');
    throw e;
  }
  const subjectKey = sha256Hex(`${PROVIDER}:${apple.subject}`).slice(0, 32);
  await deps.limit(`native-auth:subject:${subjectKey}`, 20, 15 * 60_000);

  const existing = await db.authIdentity.findUnique({
    where: { provider_subject: { provider: PROVIDER, subject: apple.subject } },
    include: { user: { select: { id: true, deletionRequestedAt: true, purgeAfter: true } } },
  });

  if (existing) return signInExisting(deps, existing, input, now);
  if (input.linkCode) return linkNew(deps, apple, input, now);
  if (input.inviteCode) {
    await deps.limit(`native-invite:subject:${subjectKey}`, 5, 60 * 60_000);
    return createFromInvite(deps, apple, input, now);
  }
  throw INVITE_REQUIRED();
}

type ExistingIdentity = NonNullable<Awaited<ReturnType<PrismaClient['authIdentity']['findUnique']>>> & {
  user: { id: string; deletionRequestedAt: Date | null; purgeAfter: Date | null };
};

async function signInExisting(deps: SignInDeps, identity: ExistingIdentity, input: SignInInput, now: Date): Promise<SignInResult> {
  const { db } = deps;

  if (input.linkCode) {
    // Trying to link a subject that already belongs to someone: never moved silently.
    const code = await db.accountLinkCode.findUnique({ where: { codeHash: hashCode(input.linkCode) } });
    if (code && !code.usedAt && code.expiresAt > now && code.userId !== identity.userId) {
      throw new AppError('This Apple account is linked to another iPrep account', 409, 'SUBJECT_LINKED_ELSEWHERE');
    }
  }

  if (identity.revokedAt) {
    if (identity.revokedReason === 'account-deleted') throw new AppError('This Apple account was removed', 403, 'IDENTITY_REVOKED');
    const other = await db.authIdentity.count({ where: { userId: identity.userId, provider: PROVIDER, revokedAt: null, NOT: { id: identity.id } } });
    if (other > 0) throw new AppError('This sign-in has been replaced', 403, 'IDENTITY_REVOKED');
  }

  if (identity.user.deletionRequestedAt) {
    if (!input.cancelDeletion) {
      throw new AppError('This account is scheduled for deletion', 403, 'ACCOUNT_DELETION_PENDING', {
        purgeAfter: identity.user.purgeAfter?.toISOString() ?? null,
      });
    }
  }

  return db.$transaction(async (tx) => {
    if (identity.revokedAt) {
      await tx.authIdentity.update({ where: { id: identity.id }, data: { revokedAt: null, revokedReason: null } });
    }
    if (identity.user.deletionRequestedAt && input.cancelDeletion) {
      await tx.user.update({ where: { id: identity.userId }, data: { deletionRequestedAt: null, purgeAfter: null } });
    }
    await tx.authIdentity.update({ where: { id: identity.id }, data: { lastUsedAt: now } });
    return finish(tx, deps, identity.userId, input.device, 200);
  });
}

async function linkNew(deps: SignInDeps, apple: AppleIdentity, input: SignInInput, now: Date): Promise<SignInResult> {
  const { db } = deps;
  const code = await db.accountLinkCode.findUnique({
    where: { codeHash: hashCode(input.linkCode!) },
    include: { user: { select: { deletionRequestedAt: true } } },
  });
  if (!code || code.usedAt || code.expiresAt <= now) throw new AppError('That link code is not valid', 403, 'LINK_CODE_INVALID');
  if (code.user.deletionRequestedAt) throw new AppError('This account is scheduled for deletion', 403, 'ACCOUNT_DELETION_PENDING');

  const active = await db.authIdentity.count({ where: { userId: code.userId, provider: PROVIDER, revokedAt: null } });
  if (active > 0) throw new AppError('This account already has an Apple sign-in', 409, 'ALREADY_LINKED');

  try {
    return await db.$transaction(async (tx) => {
      const claimed = await tx.accountLinkCode.updateMany({ where: { id: code.id, usedAt: null }, data: { usedAt: now } });
      if (claimed.count !== 1) throw new AppError('That link code is not valid', 403, 'LINK_CODE_INVALID');
      await tx.authIdentity.create({
        data: { userId: code.userId, provider: PROVIDER, subject: apple.subject, emailAtLink: apple.email, lastUsedAt: now },
      });
      return finish(tx, deps, code.userId, input.device, 200);
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new AppError('This Apple account is already linked', 409, 'SUBJECT_LINKED_ELSEWHERE');
    }
    throw e;
  }
}

async function createFromInvite(deps: SignInDeps, apple: AppleIdentity, input: SignInInput, now: Date): Promise<SignInResult> {
  const { db } = deps;
  const codeHash = hashCode(input.inviteCode!);
  try {
    return await db.$transaction(async (tx) => {
      // The claim, the account and the identity commit together or not at all.
      const claimed = await tx.nativeInvite.updateMany({
        where: { codeHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw INVITE_REQUIRED();
      const user = await tx.user.create({
        // No email and no password: an Apple-created account cannot be reached through the web login form.
        data: { role: 'USER', learner: { create: {} } },
        select: { id: true },
      });
      await tx.authIdentity.create({
        data: { userId: user.id, provider: PROVIDER, subject: apple.subject, emailAtLink: apple.email, lastUsedAt: now },
      });
      await tx.nativeInvite.update({ where: { codeHash }, data: { usedByUserId: user.id } });
      return finish(tx, deps, user.id, input.device, 201);
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new AppError('This Apple account is already linked', 409, 'SUBJECT_LINKED_ELSEWHERE');
    }
    throw e;
  }
}

async function finish(
  tx: Prisma.TransactionClient,
  deps: SignInDeps,
  userId: string,
  device: DeviceInfo,
  status: 200 | 201
): Promise<SignInResult> {
  const learner = await tx.learner.upsert({ where: { userId }, update: {}, create: { userId }, select: { id: true } });
  const dev = await createDevice(tx, userId, device);
  const tokens = await issueTokens(tx, { userId, deviceId: dev.id, secret: deps.secret });
  return { status, tokens, deviceId: dev.id, userId, learnerId: learner.id };
}
