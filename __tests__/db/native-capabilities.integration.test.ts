/**
 * GET /api/native/capabilities: the server decides product access for a signed-in native device, from the stored
 * account, and nothing else. It never returns the role or email, and every other credential type is refused.
 */
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ADMIN_URL, type TestDb, createTestDb } from './helpers';

const SECRET = 'caps-test-secret-0123456789abcdef';
const holder = vi.hoisted(() => ({ db: null as unknown as PrismaClient }));

vi.mock('@/lib/db', () => ({ get prisma() { return holder.db; } }));
vi.mock('@/lib/config', () => ({ getConfig: () => ({ jwt: { secret: 'caps-test-secret-0123456789abcdef' }, admin: { email: 'x@example.com' } }) }));
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
import { generateToken } from '@/lib/auth';
import { generateInviteCode, hashCode } from '@/lib/native/codes';
import { generateMachineToken, hashMachineToken } from '@/lib/machine-auth';

const base = 'http://localhost:3000';
const get = (headers: Record<string, string> = {}) => new NextRequest(`${base}/api/native/capabilities`, { headers });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const tokenFor = (subject: string) => `tok:${subject}${'-'.repeat(24)}`;

describe.skipIf(!ADMIN_URL)('native capabilities', () => {
  let t: TestDb;
  let caps: (req: NextRequest) => Promise<Response>;
  let apple: (req: NextRequest) => Promise<Response>;

  async function signIn(subject: string) {
    const code = generateInviteCode();
    await holder.db.nativeInvite.create({ data: { codeHash: hashCode(code), expiresAt: new Date(Date.now() + 86_400_000) } });
    const res = await apple(
      new NextRequest(`${base}/api/auth/native/apple`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identityToken: tokenFor(subject), nonce: 'nonce-abcdefgh', inviteCode: code, device: { platform: 'ios', appVersion: '1.1.0', name: 'test' } }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    return { token: body.accessToken as string, userId: body.user.id as string, deviceId: body.device.id as string };
  }

  beforeAll(async () => {
    t = await createTestDb('p2caps');
    holder.db = t.app;
    process.env.JWT_SECRET = SECRET;
    caps = ((await import('@/app/api/native/capabilities/route')) as { GET: typeof caps }).GET;
    apple = ((await import('@/app/api/auth/native/apple/route')) as { POST: typeof apple }).POST;
  }, 180_000);
  beforeEach(() => setRateLimitStore(new MemoryRateLimitStore()));
  afterAll(async () => {
    await t?.teardown();
  });

  it('an ADMIN account gets unlimited, a normal account does not, a flagged premium account does', async () => {
    const admin = await signIn('caps-admin');
    const normal = await signIn('caps-normal');
    const paid = await signIn('caps-paid');
    await t.owner.$executeRawUnsafe(`UPDATE "User" SET role = 'ADMIN' WHERE id = $1`, admin.userId);
    await t.owner.$executeRawUnsafe(`UPDATE "User" SET "isPremium" = true WHERE id = $1`, paid.userId);

    const a = await caps(get(bearer(admin.token)));
    expect(a.status).toBe(200);
    expect(a.headers.get('cache-control')).toBe('no-store');
    expect(await a.json()).toEqual({ productAccess: { unlimited: true }, ttlSeconds: 604800 });

    expect(await (await caps(get(bearer(normal.token)))).json()).toEqual({ productAccess: { unlimited: false }, ttlSeconds: 604800 });
    expect((await (await caps(get(bearer(paid.token)))).json()).productAccess.unlimited).toBe(true);
  });

  it('is re-derived on every call: demoting the account removes access at the next refresh', async () => {
    const u = await signIn('caps-demote');
    await t.owner.$executeRawUnsafe(`UPDATE "User" SET role = 'ADMIN' WHERE id = $1`, u.userId);
    expect((await (await caps(get(bearer(u.token)))).json()).productAccess.unlimited).toBe(true);
    await t.owner.$executeRawUnsafe(`UPDATE "User" SET role = 'USER' WHERE id = $1`, u.userId);
    expect((await (await caps(get(bearer(u.token)))).json()).productAccess.unlimited).toBe(false);
  });

  it('never returns the role or email, or any extra field', async () => {
    const u = await signIn('caps-shape');
    await t.owner.$executeRawUnsafe(`UPDATE "User" SET role = 'ADMIN', email = 'owner@example.com' WHERE id = $1`, u.userId);
    const text = await (await caps(get(bearer(u.token)))).text();
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['productAccess', 'ttlSeconds']);
    expect(Object.keys(JSON.parse(text).productAccess)).toEqual(['unlimited']);
    expect(text).not.toMatch(/ADMIN|role|email|owner@example\.com/i);
  });

  it('refuses no token, garbage, a machine token, a web cookie and a web JWT', async () => {
    const u = await signIn('caps-refuse');
    expect((await caps(get())).status).toBe(401);
    expect((await caps(get(bearer('not-a-token')))).status).toBe(401);

    const machine = generateMachineToken();
    const learner = await t.owner.learner.findUniqueOrThrow({ where: { userId: u.userId } });
    await t.owner.machinePrincipal.create({
      data: { name: 'caps-machine', tokenHash: hashMachineToken(machine), tokenPrefix: machine.slice(0, 8), scopes: ['progress:read'], userId: u.userId, learnerId: learner.id },
    });
    expect((await caps(get(bearer(machine)))).status).toBe(401);

    expect((await caps(get({ cookie: `auth-token=${generateToken(u.userId)}` }))).status).toBe(401);
    expect((await caps(get(bearer(generateToken(u.userId))))).status).toBe(401);
  });

  it('refuses a revoked device and an account that is scheduled for deletion', async () => {
    const revoked = await signIn('caps-revoked');
    await t.owner.$executeRawUnsafe(`UPDATE "Device" SET "revokedAt" = now() WHERE id = $1`, revoked.deviceId);
    expect((await caps(get(bearer(revoked.token)))).status).toBe(401);

    const pending = await signIn('caps-pending');
    await t.owner.$executeRawUnsafe(`UPDATE "User" SET "deletionRequestedAt" = now(), "purgeAfter" = now() + interval '30 days' WHERE id = $1`, pending.userId);
    expect((await caps(get(bearer(pending.token)))).status).toBe(403);
  });

  it('is rate limited per device', async () => {
    const u = await signIn('caps-rate');
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await caps(get(bearer(u.token)))).status;
    expect(last).toBe(429);
  });
});
