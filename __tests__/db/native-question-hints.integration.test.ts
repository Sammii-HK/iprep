/**
 * GET /api/native/question-hints returns the signed-in device's OWN question hints, keyed by text, for on-device
 * feedback. Other users' banks, archived questions and questions without a hint never appear.
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
const get = (headers: Record<string, string> = {}) => new NextRequest(`${base}/api/native/question-hints`, { headers });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const tokenFor = (subject: string) => `tok:${subject}${'-'.repeat(24)}`;

describe.skipIf(!ADMIN_URL)('native question hints', () => {
  let t: TestDb;
  let list: (req: NextRequest) => Promise<Response>;
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
    return { token: body.accessToken as string, userId: body.user.id as string };
  }

  async function bank(userId: string | null, title: string, questions: Array<{ text: string; hint: string | null; archived?: boolean }>) {
    const b = await t.owner.questionBank.create({ data: { title, userId } });
    for (const q of questions) {
      await t.owner.question.create({
        data: { bankId: b.id, text: q.text, hint: q.hint, tags: [], difficulty: 3, archivedAt: q.archived ? new Date() : null },
      });
    }
  }

  const read = async (token: string) => {
    const res = await list(get(bearer(token)));
    expect(res.status).toBe(200);
    return ((await res.json()) as { hints: Array<{ text: string; hint: string }> }).hints;
  };

  beforeAll(async () => {
    t = await createTestDb('p2hints');
    holder.db = t.app;
    process.env.JWT_SECRET = SECRET;
    list = ((await import('@/app/api/native/question-hints/route')) as { GET: typeof list }).GET;
    apple = ((await import('@/app/api/auth/native/apple/route')) as { POST: typeof apple }).POST;
  }, 180_000);
  beforeEach(() => setRateLimitStore(new MemoryRateLimitStore()));
  afterAll(async () => {
    await t?.teardown();
  });

  it('returns the learner\'s own hinted questions and nothing else', async () => {
    const me = await signIn('qh-me');
    const other = await signIn('qh-other');
    await bank(me.userId, 'Mine', [
      { text: 'Why Prismic?', hint: '- headless CMS\n- slices' },
      { text: 'No hint here', hint: null },
      { text: 'Archived one', hint: 'old', archived: true },
    ]);
    await bank(other.userId, 'Theirs', [{ text: 'Their question', hint: 'their notes' }]);
    await bank(null, 'Shared', [{ text: 'Shared question', hint: 'shared notes' }]);

    const hints = await read(me.token);
    expect(hints).toEqual([{ text: 'Why Prismic?', hint: '- headless CMS\n- slices' }]);
    expect((await read(other.token)).map((h) => h.text)).toEqual(['Their question']);
  });

  it('de-duplicates by normalised text and exposes only text and hint', async () => {
    const u = await signIn('qh-dedupe');
    await bank(u.userId, 'A', [{ text: 'Tell me  about yourself', hint: 'first' }]);
    await bank(u.userId, 'B', [{ text: 'tell me about YOURSELF', hint: 'second' }]);
    const res = await list(get(bearer(u.token)));
    const body = await res.json();
    expect(body.hints).toHaveLength(1);
    expect(Object.keys(body)).toEqual(['hints']);
    expect(Object.keys(body.hints[0]).sort()).toEqual(['hint', 'text']);
    expect(JSON.stringify(body)).not.toMatch(/userId|bankId|"id"/);
  });

  it('refuses no token, garbage, a machine token, a web cookie, a web JWT and a revoked device', async () => {
    const u = await signIn('qh-refuse');
    const machine = generateMachineToken();
    const learner = await t.owner.learner.findUniqueOrThrow({ where: { userId: u.userId } });
    await t.owner.machinePrincipal.create({
      data: { name: 'qh-machine', tokenHash: hashMachineToken(machine), tokenPrefix: machine.slice(0, 8), scopes: ['progress:read'], userId: u.userId, learnerId: learner.id },
    });
    expect((await list(get())).status).toBe(401);
    expect((await list(get(bearer('not-a-token')))).status).toBe(401);
    expect((await list(get(bearer(machine)))).status).toBe(401);
    expect((await list(get({ cookie: `auth-token=${generateToken(u.userId)}` }))).status).toBe(401);
    expect((await list(get(bearer(generateToken(u.userId))))).status).toBe(401);
    await t.owner.$executeRawUnsafe(`UPDATE "Device" SET "revokedAt" = now() WHERE "userId" = $1`, u.userId);
    expect((await list(get(bearer(u.token)))).status).toBe(401);
  });

  it('is rate limited per device', async () => {
    const u = await signIn('qh-rate');
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await list(get(bearer(u.token)))).status;
    expect(last).toBe(429);
  });
});
