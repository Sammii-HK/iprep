/**
 * One authenticated user + one app installation = one Device.
 *
 * The invariant is enforced by the database (a partial unique index plus an atomic INSERT ... ON CONFLICT), so these
 * tests deliberately do not rely on any client-side guard. The installation id identifies the installation only.
 */
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ADMIN_URL, type TestDb, createTestDb } from './helpers';

const SECRET = 'device-identity-secret-0123456789abcdef';
const holder = vi.hoisted(() => ({ db: null as unknown as PrismaClient }));

vi.mock('@/lib/db', () => ({ get prisma() { return holder.db; } }));
vi.mock('@/lib/config', () => ({ getConfig: () => ({ jwt: { secret: 'device-identity-secret-0123456789abcdef' }, admin: { email: 'x@example.com' } }) }));
vi.mock('@/lib/native/apple', async (orig) => {
  const real = await orig<typeof import('@/lib/native/apple')>();
  return {
    ...real,
    verifyAppleIdentityToken: async (token: string) => {
      if (!token.startsWith('tok:')) throw new real.AppleVerificationError('bad');
      return { subject: token.slice(4).replace(/-+$/, ''), email: null, emailVerified: false };
    },
  };
});

import { MemoryRateLimitStore, setRateLimitStore } from '@/lib/rate-limit';
import { generateInviteCode, hashCode } from '@/lib/native/codes';
import { signInWithApple, type SignInInput } from '@/lib/native/signin';
import { AppleVerificationError, type AppleIdentity } from '@/lib/native/apple';
import { revokeDevice, rotateRefreshToken } from '@/lib/native/session';
import { verifyNativeAccessToken } from '@/lib/native/tokens';

const INSTALL_A = '11111111-1111-4111-8111-aaaaaaaaaaaa';
const INSTALL_B = '22222222-2222-4222-8222-bbbbbbbbbbbb';
const base = 'http://localhost:3000';

describe.skipIf(!ADMIN_URL)('device identity: one user + one installation = one Device', () => {
  let t: TestDb;
  let db: PrismaClient;
  let n = 0;

  const verify = (subject: string) => async (token: string): Promise<AppleIdentity> => {
    if (token !== `t-${subject}`) throw new AppleVerificationError('bad token');
    return { subject, email: null, emailVerified: false };
  };
  const input = (subject: string, installId: string | null | undefined, extra: Partial<SignInInput> = {}): SignInInput => ({
    identityToken: `t-${subject}`, nonce: 'n', device: { platform: 'ios', appVersion: '1.1.0', ...(installId === undefined ? {} : { installId }) }, ...extra,
  });
  const signIn = (subject: string, installId: string | null | undefined, extra: Partial<SignInInput> = {}) =>
    signInWithApple({ db, verify: verify(subject), secret: SECRET, limit: vi.fn(async () => undefined) }, input(subject, installId, extra));
  const invite = async () => {
    const code = generateInviteCode();
    await db.nativeInvite.create({ data: { codeHash: hashCode(code), expiresAt: new Date(Date.now() + 86_400_000) } });
    return code;
  };
  /** A new Apple user with an account, signed in once on `installId`. */
  async function newUser(installId: string | null | undefined) {
    const subject = `sub-${++n}`;
    const first = await signIn(subject, installId, { inviteCode: await invite() });
    return { subject, first };
  }
  const devices = (userId: string, installId?: string) =>
    t.owner.device.findMany({ where: { userId, ...(installId ? { installId } : {}) }, orderBy: { createdAt: 'asc' } });
  const active = (userId: string, installId: string) => t.owner.device.count({ where: { userId, installId, revokedAt: null } });

  beforeAll(async () => {
    t = await createTestDb('p2devid');
    db = t.app;
    holder.db = t.app;
    process.env.JWT_SECRET = SECRET;
  }, 180_000);
  beforeEach(() => setRateLimitStore(new MemoryRateLimitStore()));
  afterAll(async () => {
    await t?.teardown();
  });

  it('1. the first sign-in creates one Device and records the installation id', async () => {
    const { first } = await newUser(INSTALL_A);
    const rows = await devices(first.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.deviceId, installId: INSTALL_A, platform: 'ios', revokedAt: null });
  });

  it('2. repeated sign-in, same user + same installation, reuses the Device and does not lock out earlier tokens', async () => {
    const { subject, first } = await newUser(INSTALL_A);
    const again = await signIn(subject, INSTALL_A);
    const third = await signIn(subject, INSTALL_A.toUpperCase()); // case is normalised
    expect([again.deviceId, third.deviceId]).toEqual([first.deviceId, first.deviceId]);
    expect(await devices(first.userId)).toHaveLength(1);
    expect(again.tokens.refreshToken).not.toBe(first.tokens.refreshToken);
    // A response lost in flight must not strand the installation: the earlier family still refreshes.
    await expect(rotateRefreshToken(db, first.tokens.refreshToken, SECRET)).resolves.toMatchObject({ expiresIn: expect.any(Number) });
  });

  it('3. concurrent sign-ins on the same installation converge on one Device (no client guard involved)', async () => {
    const { subject, first } = await newUser(INSTALL_A);
    const results = await Promise.all(Array.from({ length: 12 }, () => signIn(subject, INSTALL_A)));
    expect(new Set(results.map((r) => r.deviceId))).toEqual(new Set([first.deviceId]));
    expect(await devices(first.userId)).toHaveLength(1);

    // And when the only row is a signed-out one: the revive races converge too.
    await revokeDevice(t.owner, first.deviceId, 'user-logout');
    const afterLogout = await Promise.all(Array.from({ length: 12 }, () => signIn(subject, INSTALL_A)));
    expect(new Set(afterLogout.map((r) => r.deviceId))).toEqual(new Set([first.deviceId]));
    expect(await active(first.userId, INSTALL_A)).toBe(1);
    expect(await devices(first.userId)).toHaveLength(1);
  });

  it('3b. the database itself refuses a second active Device for the same user + installation', async () => {
    const { first } = await newUser(INSTALL_A);
    await expect(
      t.owner.device.create({ data: { userId: first.userId, platform: 'ios', installId: INSTALL_A } })
    ).rejects.toMatchObject({ code: 'P2002' });
    // ...but a revoked row alongside an active one is allowed (history), and a different installation is a different Device.
    await t.owner.device.create({ data: { userId: first.userId, platform: 'ios', installId: INSTALL_A, revokedAt: new Date(), revokedReason: 'operator' } });
    await t.owner.device.create({ data: { userId: first.userId, platform: 'ios', installId: INSTALL_B } });
    await expect(t.owner.$executeRawUnsafe(`UPDATE "Device" SET "installId" = 'not-a-uuid' WHERE id = $1`, first.deviceId)).rejects.toThrow();
  });

  it('4. same user + a different installation creates another Device', async () => {
    const { subject, first } = await newUser(INSTALL_A);
    const other = await signIn(subject, INSTALL_B);
    expect(other.deviceId).not.toBe(first.deviceId);
    expect(other.userId).toBe(first.userId);
    expect(await devices(first.userId)).toHaveLength(2);
  });

  it('5. a different user with the same installation id gets their own Device and can never take over another user\'s', async () => {
    const a = await newUser(INSTALL_A);
    const b = await newUser(INSTALL_A);
    expect(b.first.deviceId).not.toBe(a.first.deviceId);
    expect(b.first.userId).not.toBe(a.first.userId);
    expect((await t.owner.device.findUniqueOrThrow({ where: { id: a.first.deviceId } })).userId).toBe(a.first.userId);
    expect((await t.owner.device.findUniqueOrThrow({ where: { id: b.first.deviceId } })).userId).toBe(b.first.userId);
    expect(await t.owner.device.count({ where: { installId: INSTALL_A, id: { in: [a.first.deviceId, b.first.deviceId] } } })).toBe(2);
    // B's session resolves to B, whatever installation id it presents.
    expect(verifyNativeAccessToken(b.first.tokens.accessToken, SECRET)).toMatchObject({ userId: b.first.userId, deviceId: b.first.deviceId });
  });

  it('6. refresh rotation still rotates credentials for the same Device and creates no Device', async () => {
    const { first } = await newUser(INSTALL_A);
    const r1 = await rotateRefreshToken(db, first.tokens.refreshToken, SECRET);
    const r2 = await rotateRefreshToken(db, r1.refreshToken, SECRET);
    expect(verifyNativeAccessToken(r2.accessToken, SECRET)).toMatchObject({ deviceId: first.deviceId, userId: first.userId });
    expect(await devices(first.userId)).toHaveLength(1);
    await expect(rotateRefreshToken(db, first.tokens.refreshToken, SECRET)).rejects.toMatchObject({ code: 'TOKEN_REUSED' }); // reuse detection unchanged
  });

  it('7. revocation is not undone: a security-revoked Device stays revoked and a fresh one is created; a signed-out one is revived', async () => {
    const { subject, first } = await newUser(INSTALL_A);
    await revokeDevice(t.owner, first.deviceId, 'refresh-reuse');
    const next = await signIn(subject, INSTALL_A);
    expect(next.deviceId).not.toBe(first.deviceId);
    expect((await t.owner.device.findUniqueOrThrow({ where: { id: first.deviceId } })).revokedReason).toBe('refresh-reuse');
    await expect(rotateRefreshToken(db, first.tokens.refreshToken, SECRET)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(await active(first.userId, INSTALL_A)).toBe(1);

    await revokeDevice(t.owner, next.deviceId, 'operator');
    const afterOperator = await signIn(subject, INSTALL_A);
    expect(afterOperator.deviceId).not.toBe(next.deviceId); // an operator revocation is not reversed by signing in again
    expect((await t.owner.device.findUniqueOrThrow({ where: { id: next.deviceId } })).revokedReason).toBe('operator');
  });

  it('8. sign out then sign in on the same installation does not accumulate Device rows', async () => {
    const { subject, first } = await newUser(INSTALL_A);
    for (let i = 0; i < 4; i++) {
      await revokeDevice(t.owner, first.deviceId, 'user-logout');
      const back = await signIn(subject, INSTALL_A);
      expect(back.deviceId).toBe(first.deviceId);
      expect(verifyNativeAccessToken(back.tokens.accessToken, SECRET)).toMatchObject({ deviceId: first.deviceId });
      const row = await t.owner.device.findUniqueOrThrow({ where: { id: first.deviceId } });
      expect(row.revokedAt).toBeNull();
    }
    expect(await devices(first.userId)).toHaveLength(1);
  });

  it('9. account switching on one installation keeps the accounts apart', async () => {
    const a = await newUser(INSTALL_A);
    await revokeDevice(t.owner, a.first.deviceId, 'user-logout'); // A signs out
    const b = await newUser(INSTALL_A); // B signs in on the same installation
    expect(b.first.deviceId).not.toBe(a.first.deviceId);
    expect((await t.owner.device.findUniqueOrThrow({ where: { id: a.first.deviceId } })).revokedAt).not.toBeNull();
    // A's old credentials do not work and are not B's.
    await expect(rotateRefreshToken(db, a.first.tokens.refreshToken, SECRET)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(verifyNativeAccessToken(b.first.tokens.accessToken, SECRET)?.userId).toBe(b.first.userId);
    // A signing back in later gets A's own Device back, not B's.
    const aBack = await signIn(a.subject, INSTALL_A);
    expect(aBack.deviceId).toBe(a.first.deviceId);
    expect(await devices(b.first.userId)).toHaveLength(1);
  });

  it('10. legacy clients (no installation id) keep today\'s behaviour: a Device per sign-in, none claimed by installation', async () => {
    const { subject, first } = await newUser(undefined);
    const again = await signIn(subject, undefined);
    const nulled = await signIn(subject, null);
    expect(new Set([first.deviceId, again.deviceId, nulled.deviceId]).size).toBe(3);
    const rows = await devices(first.userId);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.installId === null)).toBe(true);
    // A malformed id is treated as absent by the library; the route and the database both refuse it outright (below).
    const malformed = await signIn(subject, 'not-a-uuid');
    expect((await t.owner.device.findUniqueOrThrow({ where: { id: malformed.deviceId } })).installId).toBeNull();
  });

  describe('HTTP', () => {
    type Handler = (req: NextRequest) => Promise<Response>;
    let apple: Handler;
    let refresh: Handler;
    beforeAll(async () => {
      apple = ((await import('@/app/api/auth/native/apple/route')) as { POST: Handler }).POST;
      refresh = ((await import('@/app/api/auth/native/refresh/route')) as { POST: Handler }).POST;
    });
    const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
      new NextRequest(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const appleBody = async (subject: string, device: Record<string, unknown>) => ({
      identityToken: `tok:${subject}${'-'.repeat(24)}`, nonce: 'nonce-abcdefgh', inviteCode: await invite(), device,
    });

    it('rejects a malformed installation id at the route', async () => {
      const res = await apple(post('/api/auth/native/apple', await appleBody('http-bad', { platform: 'ios', installId: 'not-a-uuid' })));
      expect(res.status).toBe(400);
      expect(await t.owner.user.count({ where: { authIdentities: { some: { subject: 'http-bad' } } } })).toBe(0);
    });

    it('sign-in through the route stores the id once and reuses the Device on repeat', async () => {
      const r1 = await apple(post('/api/auth/native/apple', await appleBody('http-ok', { platform: 'ios', appVersion: '1.1.0', installId: INSTALL_B })));
      expect(r1.status).toBe(201);
      const b1 = await r1.json();
      const r2 = await apple(post('/api/auth/native/apple', { identityToken: `tok:http-ok${'-'.repeat(24)}`, nonce: 'nonce-abcdefgh', device: { platform: 'ios', installId: INSTALL_B } }));
      expect(r2.status).toBe(200);
      expect((await r2.json()).device.id).toBe(b1.device.id);
    });

    it('a session that predates installation ids adopts the app\'s id on refresh, only if it has none and only if free', async () => {
      const legacy = await newUser(undefined);
      const dev = legacy.first.deviceId;
      const refreshWith = async (token: string, header?: string) => {
        const res = await refresh(post('/api/auth/native/refresh', { refreshToken: token }, header ? { 'x-iprep-install-id': header } : {}));
        expect(res.status).toBe(200);
        return (await res.json()).refreshToken as string;
      };
      let token = await refreshWith(legacy.first.tokens.refreshToken, 'garbage');
      expect((await t.owner.device.findUniqueOrThrow({ where: { id: dev } })).installId).toBeNull(); // garbage ignored
      token = await refreshWith(token, INSTALL_A);
      expect((await t.owner.device.findUniqueOrThrow({ where: { id: dev } })).installId).toBe(INSTALL_A); // bound
      token = await refreshWith(token, INSTALL_B);
      expect((await t.owner.device.findUniqueOrThrow({ where: { id: dev } })).installId).toBe(INSTALL_A); // never overwritten

      // The next sign-in on that installation now reuses it instead of adding a Device.
      const next = await signIn(legacy.subject, INSTALL_A);
      expect(next.deviceId).toBe(dev);

      // If the user already has an active Device for that installation, the legacy one is left alone (no violation).
      const other = await newUser(undefined);
      await signIn(other.subject, INSTALL_B);
      const res = await refresh(post('/api/auth/native/refresh', { refreshToken: other.first.tokens.refreshToken }, { 'x-iprep-install-id': INSTALL_B }));
      expect(res.status).toBe(200);
      expect((await t.owner.device.findUniqueOrThrow({ where: { id: other.first.deviceId } })).installId).toBeNull();
      void token;
    });
  });
});

describe.skipIf(!ADMIN_URL)('device install id migration rollback', () => {
  it('restores the pre-change Device shape and leaves existing Device rows working', async () => {
    const { readFileSync } = await import('fs');
    const { splitSql } = await import('./helpers');
    const t2 = await createTestDb('p2devrollback');
    try {
      const u = await t2.owner.user.create({ data: { role: 'USER' }, select: { id: true } });
      await t2.owner.device.create({ data: { userId: u.id, platform: 'ios', installId: INSTALL_A } });
      const before = await t2.owner.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'Device_one_active_per_installation'`);
      expect(before[0].n).toBe(1);

      for (const stmt of splitSql(readFileSync('docs/p2-device-install-id-rollback.sql', 'utf8'))) await t2.owner.$executeRawUnsafe(stmt);

      const cols = await t2.owner.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'Device' AND column_name = 'installId'`);
      const idx = await t2.owner.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'Device_one_active_per_installation'`);
      const rows = await t2.owner.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "Device"`);
      expect([cols[0].n, idx[0].n, rows[0].n]).toEqual([0, 0, 1]);
    } finally {
      await t2.teardown();
    }
  }, 180_000);
});
