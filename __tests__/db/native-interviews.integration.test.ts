/**
 * GET /api/native/interviews reads the ONE canonical Interview table for the signed-in device's own learner.
 * Notion sync, manual entry and a later calendar import all land there; the phone holds no source credential.
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
const get = (headers: Record<string, string> = {}) => new NextRequest(`${base}/api/native/interviews`, { headers });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const tokenFor = (subject: string) => `tok:${subject}${'-'.repeat(24)}`;

const day = 24 * 3600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const item = (externalId: string, company: string, startsInMs: number, extra: Record<string, unknown> = {}) => ({
  externalId,
  company,
  role: 'Software Engineer',
  startsAt: iso(startsInMs),
  ...extra,
});

describe.skipIf(!ADMIN_URL)('native interviews', () => {
  let t: TestDb;
  let list: (req: NextRequest) => Promise<Response>;
  let sync: (req: NextRequest) => Promise<Response>;
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

  /** A notion-sync machine principal for this learner: the same credential type the Notion sync script uses. */
  async function syncCredential(userId: string) {
    const machine = generateMachineToken();
    const learner = await t.owner.learner.findUniqueOrThrow({ where: { userId } });
    await t.owner.machinePrincipal.create({
      data: { name: `notion-sync-${userId.slice(-6)}`, tokenHash: hashMachineToken(machine), tokenPrefix: machine.slice(0, 8), scopes: ['interviews:sync', 'folders:read'], userId, learnerId: learner.id },
    });
    return machine;
  }

  const push = (machine: string, interviews: unknown[], complete = true) =>
    sync(
      new NextRequest(`${base}/api/interviews/sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...bearer(machine) },
        body: JSON.stringify({ source: 'notion', complete, interviews }),
      })
    );

  const read = async (token: string) => {
    const res = await list(get(bearer(token)));
    expect(res.status).toBe(200);
    return (await res.json()) as { interviews: Array<Record<string, string>>; nextId: string | null; serverTime: string };
  };

  beforeAll(async () => {
    t = await createTestDb('p2interviews');
    holder.db = t.app;
    process.env.JWT_SECRET = SECRET;
    list = ((await import('@/app/api/native/interviews/route')) as { GET: typeof list }).GET;
    sync = ((await import('@/app/api/interviews/sync/route')) as { POST: typeof sync }).POST;
    apple = ((await import('@/app/api/auth/native/apple/route')) as { POST: typeof apple }).POST;
  }, 180_000);
  beforeEach(() => setRateLimitStore(new MemoryRateLimitStore()));
  afterAll(async () => {
    await t?.teardown();
  });

  it('a Notion-synced interview reaches the signed-in device with its provenance, ordered soonest first', async () => {
    const u = await signIn('iv-basic');
    const machine = await syncCredential(u.userId);
    const res = await push(machine, [
      item('n-later', 'Personio', 6 * day, { round: 'Final', interviewer: 'A. Person', timeZone: 'Europe/Berlin', sourceUpdatedAt: '2026-10-05T18:30:00.000Z' }),
      item('n-soon', 'Prismic', day / 2, { round: 'Screening', interviewer: 'Michael Dossett', link: 'https://meet.example.com/x', timeZone: 'Europe/London' }),
    ]);
    expect(res.status).toBe(200);

    const body = await read(u.token);
    expect(body.interviews.map((i) => i.company)).toEqual(['Prismic', 'Personio']);
    expect(body.nextId).toBe(body.interviews[0].id);
    expect(body.interviews[0]).toMatchObject({ source: 'notion', round: 'Screening', interviewer: 'Michael Dossett', timeZone: 'Europe/London', status: 'scheduled' });
    expect(body.interviews[1].sourceUpdatedAt).toBe('2026-10-05T18:30:00.000Z');
  });

  it('never exposes the external id, notes, user id, folder id, or any credential', async () => {
    const u = await signIn('iv-shape');
    const machine = await syncCredential(u.userId);
    await push(machine, [item('secret-page-id', 'Prismic', day)]);
    const text = await (await list(get(bearer(u.token)))).text();
    expect(text).not.toMatch(/secret-page-id|externalId|userId|folderId|notes|ipm_/);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['interviews', 'nextId', 'serverTime']);
  });

  it('a device only ever sees its own learner interviews', async () => {
    const mine = await signIn('iv-own-a');
    const other = await signIn('iv-own-b');
    await push(await syncCredential(mine.userId), [item('mine-1', 'MineCo', day)]);
    await push(await syncCredential(other.userId), [item('theirs-1', 'TheirCo', day)]);
    expect((await read(mine.token)).interviews.map((i) => i.company)).toEqual(['MineCo']);
    expect((await read(other.token)).interviews.map((i) => i.company)).toEqual(['TheirCo']);
  });

  it('a reschedule updates the same record and never creates a second', async () => {
    const u = await signIn('iv-resched');
    const machine = await syncCredential(u.userId);
    await push(machine, [item('r1', 'Prismic', day, { round: 'Screening' })]);
    const first = (await read(u.token)).interviews;
    await push(machine, [item('r1', 'Prismic', 3 * day, { round: 'Screening' })]);
    const second = (await read(u.token)).interviews;
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe(first[0].id);
    expect(new Date(second[0].startsAt).getTime()).toBeGreaterThan(new Date(first[0].startsAt).getTime() + day);
    expect(await t.owner.interview.count({ where: { userId: u.userId } })).toBe(1);
  });

  it('a cancelled interview is no longer listed, and reappearing in Notion reschedules it (same record)', async () => {
    const u = await signIn('iv-cancel');
    const machine = await syncCredential(u.userId);
    await push(machine, [item('c1', 'Prismic', day), item('c2', 'Personio', 2 * day)]);
    await push(machine, [item('c2', 'Personio', 2 * day)]); // complete sync that no longer has c1
    expect((await read(u.token)).interviews.map((i) => i.company)).toEqual(['Personio']);
    expect((await t.owner.interview.findFirstOrThrow({ where: { userId: u.userId, externalId: 'c1' } })).status).toBe('cancelled');

    await push(machine, [item('c1', 'Prismic', day), item('c2', 'Personio', 2 * day)]);
    expect((await read(u.token)).interviews.map((i) => i.company)).toEqual(['Prismic', 'Personio']);
    expect(await t.owner.interview.count({ where: { userId: u.userId } })).toBe(2);
  });

  it('a complete Notion sync never deletes or cancels a manual interview, and a Notion duplicate outranks it without removing it', async () => {
    const u = await signIn('iv-manual');
    const machine = await syncCredential(u.userId);
    const manualStart = new Date(Date.now() + 2 * day);
    await t.owner.interview.create({ data: { userId: u.userId, company: 'Handmade Ltd', role: 'Engineer', startsAt: manualStart, source: 'manual' } });
    await t.owner.interview.create({ data: { userId: u.userId, company: 'Prismic', role: 'Engineer', startsAt: new Date(Date.now() + day), source: 'manual' } });

    await push(machine, [item('m-n1', 'Prismic', day, { round: 'Screening' })]);
    const body = await read(u.token);
    expect(body.interviews.map((i) => `${i.company}:${i.source}`)).toEqual(['Prismic:notion', 'Handmade Ltd:manual']);

    await push(machine, []); // the source drops everything
    const after = await read(u.token);
    expect(after.interviews.map((i) => `${i.company}:${i.source}`)).toEqual(['Prismic:manual', 'Handmade Ltd:manual']);
    expect(await t.owner.interview.count({ where: { userId: u.userId, source: 'manual', status: 'scheduled' } })).toBe(2);
  });

  it('lists an in-progress interview and omits a long-finished one', async () => {
    const u = await signIn('iv-window');
    const machine = await syncCredential(u.userId);
    await push(machine, [item('w-now', 'RunningCo', -20 * 60_000), item('w-old', 'OldCo', -3 * day)], false);
    expect((await read(u.token)).interviews.map((i) => i.company)).toEqual(['RunningCo']);
  });

  it('refuses no token, garbage, a machine token, a web cookie, a web JWT and a revoked device', async () => {
    const u = await signIn('iv-refuse');
    const machine = await syncCredential(u.userId);
    expect((await list(get())).status).toBe(401);
    expect((await list(get(bearer('not-a-token')))).status).toBe(401);
    expect((await list(get(bearer(machine)))).status).toBe(401);
    expect((await list(get({ cookie: `auth-token=${generateToken(u.userId)}` }))).status).toBe(401);
    expect((await list(get(bearer(generateToken(u.userId))))).status).toBe(401);
    await t.owner.$executeRawUnsafe(`UPDATE "Device" SET "revokedAt" = now() WHERE "userId" = $1`, u.userId);
    expect((await list(get(bearer(u.token)))).status).toBe(401);
  });

  it('is rate limited per device', async () => {
    const u = await signIn('iv-rate');
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await list(get(bearer(u.token)))).status;
    expect(last).toBe(429);
  });
});
