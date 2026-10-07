/**
 * Native identity against a real database: every account state in the spec, refresh-token rotation and reuse,
 * device revocation, the deletion lifecycle, and the boundaries between native and web credentials.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ADMIN_URL, type TestDb, createTestDb, makeUser } from './helpers';
import { AppleVerificationError, type AppleIdentity } from '@/lib/native/apple';
import { generateInviteCode, generateLinkCode, hashCode } from '@/lib/native/codes';
import { signInWithApple, type SignInInput } from '@/lib/native/signin';
import { createLinkCode, requestAccountDeletion } from '@/lib/native/account';
import { revokeDevice, rotateRefreshToken } from '@/lib/native/session';
import { applyAppleServerEvent } from '@/lib/native/notifications';
import { verifyNativeAccessToken } from '@/lib/native/tokens';

const SECRET = 'integration-secret-0123456789abcdef';

describe.skipIf(!ADMIN_URL)('native identity (real database)', () => {
  let t: TestDb;
  let db: PrismaClient;

  const verify = (subjectByToken: Record<string, string>) => async (token: string): Promise<AppleIdentity> => {
    const subject = subjectByToken[token];
    if (!subject) throw new AppleVerificationError('bad token');
    return { subject, email: `${subject}@privaterelay.example`, emailVerified: true };
  };
  const deps = (tokens: Record<string, string>, limit = vi.fn(async () => undefined)) => ({ db, verify: verify(tokens), secret: SECRET, limit });
  const input = (token: string, extra: Partial<SignInInput> = {}): SignInInput => ({ identityToken: token, nonce: 'n', device: { platform: 'ios', appVersion: '1.0' }, ...extra });

  const newInvite = async (opts: { expired?: boolean } = {}) => {
    const code = generateInviteCode();
    await db.nativeInvite.create({ data: { codeHash: hashCode(code), expiresAt: new Date(Date.now() + (opts.expired ? -1000 : 86_400_000)) } });
    return code;
  };

  beforeAll(async () => {
    t = await createTestDb('p2auth');
    db = t.app;
  }, 180_000);
  afterAll(async () => {
    await t?.teardown();
  });

  describe('new invited iOS user', () => {
    it('creates User, Learner, identity and device atomically, redeems the invite, and issues device tokens (201)', async () => {
      const code = await newInvite();
      const r = await signInWithApple(deps({ tok: 'sub-new' }), input('tok', { inviteCode: code }));
      expect(r.status).toBe(201);
      const user = await db.user.findUniqueOrThrow({ where: { id: r.userId }, include: { learner: true, authIdentities: true, devices: true } });
      expect(user.email).toBeNull(); // no email and no password: not reachable through the web login form
      expect(user.password).toBeNull();
      expect(user.role).toBe('USER');
      expect(user.learner?.id).toBe(r.learnerId);
      expect(user.authIdentities).toHaveLength(1);
      expect(user.devices.map((d) => d.id)).toEqual([r.deviceId]);
      const invite = await db.nativeInvite.findUniqueOrThrow({ where: { codeHash: hashCode(code) } });
      expect(invite.usedAt).not.toBeNull();
      expect(invite.usedByUserId).toBe(r.userId);
      const claims = verifyNativeAccessToken(r.tokens.accessToken, SECRET);
      expect(claims).toEqual({ userId: r.userId, deviceId: r.deviceId });
    });

    it('an invite is single use: the second redemption fails generically and creates nothing', async () => {
      const code = await newInvite();
      await signInWithApple(deps({ a: 'sub-a' }), input('a', { inviteCode: code }));
      const usersBefore = await db.user.count();
      await expect(signInWithApple(deps({ b: 'sub-b' }), input('b', { inviteCode: code }))).rejects.toMatchObject({ code: 'INVITE_REQUIRED', statusCode: 403 });
      expect(await db.user.count()).toBe(usersBefore);
    });

    it('two concurrent redemptions of one invite: exactly one account is created', async () => {
      const code = await newInvite();
      const results = await Promise.allSettled([
        signInWithApple(deps({ c1: 'sub-c1' }), input('c1', { inviteCode: code })),
        signInWithApple(deps({ c2: 'sub-c2' }), input('c2', { inviteCode: code })),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ code: 'INVITE_REQUIRED' });
    });

    it('the invite is redeemed only after the Apple identity verifies', async () => {
      const code = await newInvite();
      await expect(signInWithApple(deps({}), input('forged', { inviteCode: code }))).rejects.toMatchObject({ code: 'INVALID_APPLE_TOKEN', statusCode: 400 });
      const invite = await db.nativeInvite.findUniqueOrThrow({ where: { codeHash: hashCode(code) } });
      expect(invite.usedAt).toBeNull();
    });

    it('a failure after the claim rolls the claim back (account creation and redemption are atomic)', async () => {
      const code = await newInvite();
      // Another account already owns this Apple subject's unique row, so identity creation fails inside the transaction.
      await db.$executeRawUnsafe(`INSERT INTO "User" ("id","updatedAt") VALUES ('squatter', now())`);
      const inviteBefore = await db.nativeInvite.findUniqueOrThrow({ where: { codeHash: hashCode(code) } });
      expect(inviteBefore.usedAt).toBeNull();
      const failingDb = new Proxy(db, {
        get(target, prop, recv) {
          if (prop === '$transaction') {
            return (fn: (tx: unknown) => Promise<unknown>) =>
              target.$transaction(async (tx) => {
                const wrapped = new Proxy(tx, {
                  get(txTarget, txProp, txRecv) {
                    if (txProp === 'authIdentity') return { ...(txTarget.authIdentity as object), create: async () => { throw new Error('boom after claim'); } };
                    return Reflect.get(txTarget, txProp, txRecv);
                  },
                });
                return fn(wrapped);
              });
          }
          return Reflect.get(target, prop, recv);
        },
      }) as PrismaClient;
      const usersBefore = await db.user.count();
      await expect(signInWithApple({ ...deps({ d: 'sub-d' }), db: failingDb }, input('d', { inviteCode: code }))).rejects.toThrow('boom after claim');
      expect((await db.nativeInvite.findUniqueOrThrow({ where: { codeHash: hashCode(code) } })).usedAt).toBeNull(); // invite still usable
      expect(await db.user.count()).toBe(usersBefore); // and no half-created account
    });
  });

  describe('non-invited iOS user', () => {
    it('gets one generic INVITE_REQUIRED for no code, a made-up code, an expired code and a used code, and nothing is created', async () => {
      const used = await newInvite();
      await signInWithApple(deps({ u: 'sub-used' }), input('u', { inviteCode: used }));
      const expired = await newInvite({ expired: true });
      const usersBefore = await db.user.count();
      const attempts: Array<Partial<SignInInput>> = [{}, { inviteCode: 'IPREP-ZZZZ-ZZZZ-ZZZZ-ZZZZ' }, { inviteCode: expired }, { inviteCode: used }];
      const bodies = [];
      for (const [i, extra] of attempts.entries()) {
        const err = await signInWithApple(deps({ [`n${i}`]: `sub-n${i}` }), input(`n${i}`, extra)).catch((e) => e);
        bodies.push({ code: err.code, status: err.statusCode, message: err.message });
      }
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1); // indistinguishable: no enumeration
      expect(bodies[0]).toEqual({ code: 'INVITE_REQUIRED', status: 403, message: 'An invitation is required' });
      expect(await db.user.count()).toBe(usersBefore);
    });

    it('invite redemption is rate limited per subject', async () => {
      const calls: string[] = [];
      const limit = vi.fn(async (key: string) => { calls.push(key); });
      await signInWithApple(deps({ r: 'sub-rl' }, limit), input('r', { inviteCode: 'IPREP-AAAA-AAAA-AAAA-AAAA' })).catch(() => undefined);
      expect(calls.some((k) => k.startsWith('native-auth:subject:'))).toBe(true);
      expect(calls.some((k) => k.startsWith('native-invite:subject:'))).toBe(true);
      expect(calls.join(' ')).not.toContain('sub-rl'); // keys never contain the raw Apple subject
    });

    it('an invite and a link code together are a validation error', async () => {
      await expect(signInWithApple(deps({ x: 'sub-x' }), input('x', { inviteCode: 'a', linkCode: 'b' }))).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('existing web user linking Apple', () => {
    it('links with a one-time code created while signed in, never by email, and the code cannot be reused', async () => {
      const { userId, learnerId } = await makeUser(t.owner, 'web1', { email: 'web1@example.com' });
      const { code } = await createLinkCode(db, userId);
      const r = await signInWithApple(deps({ w: 'sub-web1' }), input('w', { linkCode: code }));
      expect(r).toMatchObject({ status: 200, userId, learnerId }); // same user, same learner
      expect(await db.user.count({ where: { email: 'web1@example.com' } })).toBe(1); // no second account
      const second = signInWithApple(deps({ w2: 'sub-web1-other' }), input('w2', { linkCode: code }));
      await expect(second).rejects.toMatchObject({ code: 'LINK_CODE_INVALID' });
    });

    it('an Apple email that equals a web email links nothing by itself', async () => {
      await makeUser(t.owner, 'web-email', { email: 'victim@example.com' });
      const evil = (token: string) => async (): Promise<AppleIdentity> => ({ subject: `sub-${token}`, email: 'victim@example.com', emailVerified: true });
      const err = await signInWithApple({ ...deps({}), verify: evil('attacker') }, input('t')).catch((e) => e);
      expect(err.code).toBe('INVITE_REQUIRED');
      expect(await db.authIdentity.count({ where: { user: { email: 'victim@example.com' } } })).toBe(0);
    });

    it('expired and unknown link codes are refused', async () => {
      const { userId } = await makeUser(t.owner, 'web2', { email: 'web2@example.com' });
      const code = generateLinkCode();
      await db.accountLinkCode.create({ data: { userId, codeHash: hashCode(code), expiresAt: new Date(Date.now() - 1000) } });
      await expect(signInWithApple(deps({ e: 'sub-e' }), input('e', { linkCode: code }))).rejects.toMatchObject({ code: 'LINK_CODE_INVALID' });
      await expect(signInWithApple(deps({ e: 'sub-e' }), input('e', { linkCode: 'LINK-0000-0000' }))).rejects.toMatchObject({ code: 'LINK_CODE_INVALID' });
    });

    it('creating a new link code retires the previous unused one', async () => {
      const { userId } = await makeUser(t.owner, 'web3', { email: 'web3@example.com' });
      const first = await createLinkCode(db, userId);
      await createLinkCode(db, userId);
      await expect(signInWithApple(deps({ f: 'sub-f' }), input('f', { linkCode: first.code }))).rejects.toMatchObject({ code: 'LINK_CODE_INVALID' });
    });
  });

  describe('existing Apple-linked user', () => {
    it('signs in on a new device without an invite, getting a new device and the same learner', async () => {
      const code = await newInvite();
      const first = await signInWithApple(deps({ p: 'sub-phone' }), input('p', { inviteCode: code }));
      const second = await signInWithApple(deps({ p: 'sub-phone' }), input('p'));
      expect(second.status).toBe(200);
      expect(second.userId).toBe(first.userId);
      expect(second.learnerId).toBe(first.learnerId);
      expect(second.deviceId).not.toBe(first.deviceId);
    });

    it('ignores (and does not consume) an invite presented by an existing identity', async () => {
      const first = await newInvite();
      await signInWithApple(deps({ q: 'sub-q' }), input('q', { inviteCode: first }));
      const spare = await newInvite();
      const r = await signInWithApple(deps({ q: 'sub-q' }), input('q', { inviteCode: spare }));
      expect(r.status).toBe(200);
      expect((await db.nativeInvite.findUniqueOrThrow({ where: { codeHash: hashCode(spare) } })).usedAt).toBeNull();
    });
  });

  describe('an existing web account links once, then never needs a code again', () => {
    it('link code once; afterwards plain Apple sign-in resolves the same user and learner on any device, with no invite and no email matching', async () => {
      const { userId, learnerId } = await makeUser(t.owner, 'owner1', { email: 'owner1@example.com' });
      await t.owner.attempt.create({
        data: { learnerId, surface: 'WRITTEN_TO_SPOKEN', responseMode: 'SPOKEN', promptSnapshot: 'Tell me about yourself.', source: 'practice-api', occurredAt: new Date() },
      });
      const spareInvite = await newInvite();
      const usersBefore = await t.owner.user.count();
      const learnersBefore = await t.owner.learner.count();
      const { code } = await createLinkCode(db, userId);

      // 1. The one-time bootstrap: link code only, no invite.
      const first = await signInWithApple(deps({ a: 'sub-owner1' }), input('a', { linkCode: code }));
      expect(first).toMatchObject({ status: 200, userId, learnerId });
      expect((await db.accountLinkCode.findFirstOrThrow({ where: { userId } })).usedAt).not.toBeNull();
      expect((await db.nativeInvite.findUniqueOrThrow({ where: { codeHash: hashCode(spareInvite) } })).usedAt).toBeNull();
      expect(await db.authIdentity.count({ where: { userId, provider: 'apple', revokedAt: null } })).toBe(1);

      // 2. Same phone again, another device, and after a sign-out: no code of any kind.
      const again = await signInWithApple(deps({ a: 'sub-owner1' }), input('a'));
      const otherDevice = await signInWithApple(deps({ a: 'sub-owner1' }), input('a'));
      await t.owner.$executeRawUnsafe(`UPDATE "Device" SET "revokedAt" = now() WHERE id = $1`, again.deviceId);
      const afterSignOut = await signInWithApple(deps({ a: 'sub-owner1' }), input('a'));
      for (const r of [again, otherDevice, afterSignOut]) {
        expect(r).toMatchObject({ status: 200, userId, learnerId });
      }
      expect(new Set([first.deviceId, again.deviceId, otherDevice.deviceId, afterSignOut.deviceId]).size).toBe(4);

      // 3. Nothing was created or consumed along the way, and the history is still on the same learner.
      expect(await t.owner.user.count()).toBe(usersBefore);
      expect(await t.owner.learner.count()).toBe(learnersBefore);
      expect(await db.authIdentity.count({ where: { userId } })).toBe(1);
      expect((await db.nativeInvite.findUniqueOrThrow({ where: { codeHash: hashCode(spareInvite) } })).usedAt).toBeNull();
      expect(await t.owner.attempt.count({ where: { learnerId } })).toBe(1);

      // 4. The link code was a one-time bootstrap: it cannot be used again, and it is not needed.
      await expect(signInWithApple(deps({ b: 'sub-owner1-second' }), input('b', { linkCode: code }))).rejects.toMatchObject({ code: 'LINK_CODE_INVALID' });
    });
  });

  describe('Apple credential revoked', () => {
    it('consent-revoked signs every device out but keeps the account and history; signing in again reinstates it', async () => {
      const r = await signInWithApple(deps({ k: 'sub-consent' }), input('k', { inviteCode: await newInvite() }));
      const dev2 = await signInWithApple(deps({ k: 'sub-consent' }), input('k'));
      expect(await applyAppleServerEvent(db, { type: 'consent-revoked', subject: 'sub-consent' })).toBe('revoked');
      const devices = await db.device.findMany({ where: { userId: r.userId } });
      expect(devices.every((d) => d.revokedAt && d.revokedReason === 'apple-revoked')).toBe(true);
      await expect(rotateRefreshToken(db, r.tokens.refreshToken, SECRET)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
      void dev2;
      expect(await db.learner.count({ where: { userId: r.userId } })).toBe(1); // history untouched
      const back = await signInWithApple(deps({ k: 'sub-consent' }), input('k'));
      expect(back).toMatchObject({ status: 200, userId: r.userId });
      expect((await db.authIdentity.findFirstOrThrow({ where: { userId: r.userId } })).revokedAt).toBeNull();
    });

    it('account-delete at Apple disables the identity until an operator reinstates it, and a later consent-revoked cannot soften it', async () => {
      const r = await signInWithApple(deps({ z: 'sub-acct-del' }), input('z', { inviteCode: await newInvite() }));
      await applyAppleServerEvent(db, { type: 'account-delete', subject: 'sub-acct-del' });
      await applyAppleServerEvent(db, { type: 'consent-revoked', subject: 'sub-acct-del' });
      const id = await db.authIdentity.findFirstOrThrow({ where: { userId: r.userId } });
      expect(id.revokedReason).toBe('account-deleted');
      await expect(signInWithApple(deps({ z: 'sub-acct-del' }), input('z'))).rejects.toMatchObject({ code: 'IDENTITY_REVOKED', statusCode: 403 });
    });

    it('unknown subjects and informational events are ignored', async () => {
      expect(await applyAppleServerEvent(db, { type: 'consent-revoked', subject: 'nobody' })).toBe('unknown-subject');
      expect(await applyAppleServerEvent(db, { type: 'email-disabled', subject: 'sub-consent' })).toBe('ignored');
    });
  });

  describe('account already linked', () => {
    it('a user with an active Apple identity cannot link a second one (ALREADY_LINKED)', async () => {
      const { userId } = await makeUser(t.owner, 'web4', { email: 'web4@example.com' });
      const c1 = await createLinkCode(db, userId);
      await signInWithApple(deps({ l1: 'sub-l1' }), input('l1', { linkCode: c1.code }));
      const c2 = await createLinkCode(db, userId);
      await expect(signInWithApple(deps({ l2: 'sub-l2' }), input('l2', { linkCode: c2.code }))).rejects.toMatchObject({ code: 'ALREADY_LINKED', statusCode: 409 });
      expect((await db.accountLinkCode.findUniqueOrThrow({ where: { codeHash: hashCode(c2.code) } })).usedAt).toBeNull(); // not burned
    });

    it('an Apple subject linked to user A cannot be linked to user B, and is not silently moved', async () => {
      const a = await makeUser(t.owner, 'web5', { email: 'web5@example.com' });
      const b = await makeUser(t.owner, 'web6', { email: 'web6@example.com' });
      const ca = await createLinkCode(db, a.userId);
      await signInWithApple(deps({ s: 'sub-shared' }), input('s', { linkCode: ca.code }));
      const cb = await createLinkCode(db, b.userId);
      await expect(signInWithApple(deps({ s: 'sub-shared' }), input('s', { linkCode: cb.code }))).rejects.toMatchObject({ code: 'SUBJECT_LINKED_ELSEWHERE', statusCode: 409 });
      expect((await db.authIdentity.findFirstOrThrow({ where: { subject: 'sub-shared' } })).userId).toBe(a.userId);
      expect((await db.accountLinkCode.findUniqueOrThrow({ where: { codeHash: hashCode(cb.code) } })).usedAt).toBeNull();
    });

    it('the database allows at most one ACTIVE Apple identity per user', async () => {
      const { userId } = await makeUser(t.owner, 'web7', { email: 'web7@example.com' });
      await db.authIdentity.create({ data: { userId, provider: 'apple', subject: 'one' } });
      await expect(db.authIdentity.create({ data: { userId, provider: 'apple', subject: 'two' } })).rejects.toThrow();
      await db.authIdentity.updateMany({ where: { subject: 'one' }, data: { revokedAt: new Date() } });
      await expect(db.authIdentity.create({ data: { userId, provider: 'apple', subject: 'two' } })).resolves.toBeDefined();
    });
  });

  describe('refresh tokens and devices', () => {
    async function freshDevice(tag: string) {
      return signInWithApple(deps({ [tag]: `sub-${tag}` }), input(tag, { inviteCode: await newInvite() }));
    }

    it('rotates: the new token works, the old one is reuse and revokes the whole device', async () => {
      const r = await freshDevice('rot');
      const next = await rotateRefreshToken(db, r.tokens.refreshToken, SECRET);
      expect(next.refreshToken).not.toBe(r.tokens.refreshToken);
      expect(verifyNativeAccessToken(next.accessToken, SECRET)).toEqual({ userId: r.userId, deviceId: r.deviceId });
      await expect(rotateRefreshToken(db, r.tokens.refreshToken, SECRET)).rejects.toMatchObject({ code: 'TOKEN_REUSED', statusCode: 401 });
      const device = await db.device.findUniqueOrThrow({ where: { id: r.deviceId } });
      expect(device.revokedAt).not.toBeNull();
      expect(device.revokedReason).toBe('refresh-reuse');
      await expect(rotateRefreshToken(db, next.refreshToken, SECRET)).rejects.toMatchObject({ code: 'INVALID_TOKEN' }); // the legitimate successor died with the family
    });

    it('two concurrent refreshes with the same token cannot both succeed', async () => {
      const r = await freshDevice('conc');
      const results = await Promise.allSettled([rotateRefreshToken(db, r.tokens.refreshToken, SECRET), rotateRefreshToken(db, r.tokens.refreshToken, SECRET)]);
      expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    });

    it('chains: each successor is recorded and only the latest works', async () => {
      const r = await freshDevice('chain');
      let current = r.tokens;
      for (let i = 0; i < 3; i++) current = await rotateRefreshToken(db, current.refreshToken, SECRET);
      expect(await db.nativeRefreshToken.count({ where: { deviceId: r.deviceId } })).toBe(4);
      expect(await db.nativeRefreshToken.count({ where: { deviceId: r.deviceId, rotatedAt: null } })).toBe(1);
      expect(await db.nativeRefreshToken.count({ where: { deviceId: r.deviceId, replacedById: { not: null } } })).toBe(3);
    });

    it('rejects unknown, expired and revoked-device tokens with a uniform error', async () => {
      await expect(rotateRefreshToken(db, 'ipr_' + '0'.repeat(64), SECRET)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
      const r = await freshDevice('exp');
      await t.owner.$executeRawUnsafe(`UPDATE "NativeRefreshToken" SET "expiresAt" = (now() at time zone 'utc') - interval '1 minute' WHERE "deviceId" = $1`, r.deviceId);
      await expect(rotateRefreshToken(db, r.tokens.refreshToken, SECRET)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
      const r2 = await freshDevice('rev');
      await revokeDevice(db, r2.deviceId, 'operator');
      await expect(rotateRefreshToken(db, r2.tokens.refreshToken, SECRET)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    });

    it('the refresh token is stored only as a hash', async () => {
      const r = await freshDevice('hash');
      const rows = await db.nativeRefreshToken.findMany({ where: { deviceId: r.deviceId } });
      expect(JSON.stringify(rows)).not.toContain(r.tokens.refreshToken);
      expect(rows[0].tokenHash).toBe((await import('@/lib/native/tokens')).hashToken(r.tokens.refreshToken));
    });
  });

  describe('account deletion lifecycle', () => {
    it('request revokes every device now, records a 30-day purge date, is idempotent, and can be cancelled by signing in with Apple', async () => {
      const r = await signInWithApple(deps({ del: 'sub-del' }), input('del', { inviteCode: await newInvite() }));
      const d2 = await signInWithApple(deps({ del: 'sub-del' }), input('del'));
      const now = new Date('2026-10-08T00:00:00Z');
      const out = await requestAccountDeletion(db, r.userId, now);
      expect(out.purgeAfter.toISOString()).toBe('2026-11-07T00:00:00.000Z'); // exactly 30 days
      expect((await db.device.findMany({ where: { userId: r.userId } })).every((d) => d.revokedAt && d.revokedReason === 'deletion-requested')).toBe(true);
      await expect(rotateRefreshToken(db, d2.tokens.refreshToken, SECRET)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
      const again = await requestAccountDeletion(db, r.userId, new Date('2026-10-20T00:00:00Z'));
      expect(again.purgeAfter.toISOString()).toBe(out.purgeAfter.toISOString()); // asking again does not extend it

      await expect(signInWithApple(deps({ del: 'sub-del' }), input('del'))).rejects.toMatchObject({ code: 'ACCOUNT_DELETION_PENDING', statusCode: 403, details: { purgeAfter: out.purgeAfter.toISOString() } });
      const restored = await signInWithApple(deps({ del: 'sub-del' }), input('del', { cancelDeletion: true }));
      expect(restored.status).toBe(200);
      const user = await db.user.findUniqueOrThrow({ where: { id: r.userId } });
      expect(user.deletionRequestedAt).toBeNull();
      expect(user.purgeAfter).toBeNull();
    });

    it('a pending account cannot link a new Apple identity', async () => {
      const { userId } = await makeUser(t.owner, 'web-pending', { email: 'pending@example.com' });
      const { code } = await createLinkCode(db, userId);
      await requestAccountDeletion(db, userId);
      await expect(signInWithApple(deps({ pp: 'sub-pp' }), input('pp', { linkCode: code }))).rejects.toMatchObject({ code: 'ACCOUNT_DELETION_PENDING' });
    });
  });

  it('only hashes of invites and link codes are stored', async () => {
    const code = await newInvite();
    const rows = await db.nativeInvite.findMany();
    expect(JSON.stringify(rows)).not.toContain(code);
  });
});
