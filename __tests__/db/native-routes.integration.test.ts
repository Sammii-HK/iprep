/**
 * The HTTP contract end to end (route handlers against a real database): sign in, push, pull, refresh, logout,
 * deletion, and the boundaries between native tokens, web cookies and machine principals.
 */
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ADMIN_URL, type TestDb, createTestDb, makeUser } from './helpers';

const SECRET = 'route-test-secret-0123456789abcdef';
const holder = vi.hoisted(() => ({ db: null as unknown as PrismaClient }));

vi.mock('@/lib/db', () => ({ get prisma() { return holder.db; } }));
vi.mock('@/lib/config', () => ({ getConfig: () => ({ jwt: { secret: 'route-test-secret-0123456789abcdef' }, admin: { email: 'x@example.com' } }) }));
vi.mock('@/lib/native/apple', async (orig) => {
  const real = await orig<typeof import('@/lib/native/apple')>();
  return {
    ...real,
    verifyAppleIdentityToken: async (token: string) => {
      if (!token.startsWith('tok:')) throw new real.AppleVerificationError('bad');
      return { subject: token.slice(4).replace(/-+$/, ''), email: null, emailVerified: false };
    },
    verifyAppleServerNotification: async (payload: string) => {
      if (!payload.startsWith('evt:')) throw new real.AppleVerificationError('bad');
      const [, type, sub] = payload.split(':');
      return { type, subject: sub };
    },
  };
});

import { MemoryRateLimitStore, setRateLimitStore } from '@/lib/rate-limit';
import { generateToken } from '@/lib/auth';
import { generateInviteCode, hashCode } from '@/lib/native/codes';
import { generateMachineToken, hashMachineToken } from '@/lib/machine-auth';

const base = 'http://localhost:3000';
const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = (url: string, headers: Record<string, string> = {}) => new NextRequest(`${base}${url}`, { headers });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
/** Apple identity tokens are long; the mock reads the subject back from the token. */
const tokenFor = (subject: string) => `tok:${subject}${'-'.repeat(24)}`;
const cookie = (userId: string) => ({ cookie: `auth-token=${generateToken(userId)}` });

describe.skipIf(!ADMIN_URL)('native sync HTTP contract', () => {
  let t: TestDb;
  // Route modules are imported after the database mock is installed, so they are loaded dynamically.
  type Handler = (req: NextRequest, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;
  type RouteModule = Partial<Record<'GET' | 'POST' | 'PUT', Handler>>;
  const routes = {} as Record<string, Required<RouteModule>>;
  let n = 0;
  const uuid = () => `11111111-1111-4111-8111-${String(++n).padStart(12, '0')}`;

  async function signIn(subject: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    let body = extra;
    if (!('inviteCode' in extra) && !('linkCode' in extra)) {
      const code = generateInviteCode();
      await holder.db.nativeInvite.create({ data: { codeHash: hashCode(code), expiresAt: new Date(Date.now() + 86_400_000) } });
      body = { inviteCode: code, ...extra };
    }
    const res = await routes.apple.POST(json('/api/auth/native/apple', { identityToken: tokenFor(subject), nonce: 'nonce-abcdefgh', device: { platform: 'ios', appVersion: '1.0' }, ...body }, headers));
    return { res, body: await res.json() };
  }
  const evt = (over: Record<string, unknown> = {}) => ({
    type: 'attempt.created', schemaVersion: 1, eventId: uuid(), origin: 'device', surface: 'WRITTEN_TO_SPOKEN', responseMode: 'SPOKEN',
    occurredAt: new Date(Date.now() - 60_000).toISOString(),
    prompt: { text: 'Tell me about yourself.' }, evidence: { transcript: 'I build things.', transcriber: 'apple-sfspeech' }, ...over,
  });

  beforeAll(async () => {
    t = await createTestDb('p2routes');
    holder.db = t.app;
    process.env.JWT_SECRET = SECRET;
    routes.apple = (await import('@/app/api/auth/native/apple/route')) as never;
    routes.refresh = (await import('@/app/api/auth/native/refresh/route')) as never;
    routes.logout = (await import('@/app/api/auth/native/logout/route')) as never;
    routes.notify = (await import('@/app/api/auth/native/apple/notifications/route')) as never;
    routes.linkCode = (await import('@/app/api/account/apple-link-code/route')) as never;
    routes.deletion = (await import('@/app/api/account/deletion/route')) as never;
    routes.events = (await import('@/app/api/sync/events/route')) as never;
    routes.changes = (await import('@/app/api/sync/changes/route')) as never;
    routes.bankImport = (await import('@/app/api/sync/banks/import/route')) as never;
    routes.questions = (await import('@/app/api/banks/[id]/questions/route')) as never;
    routes.bank = (await import('@/app/api/banks/[id]/route')) as never;
    routes.banks = (await import('@/app/api/banks/route')) as never;
  }, 180_000);
  beforeEach(() => setRateLimitStore(new MemoryRateLimitStore()));
  afterAll(async () => {
    await t?.teardown();
  });

  it('sign-in: no invite is refused generically; an invite creates the account and returns the documented shape', async () => {
    const res = await routes.apple.POST(json('/api/auth/native/apple', { identityToken: tokenFor('sub-noinvite'), nonce: 'nonce-abcdefgh', device: { platform: 'ios' } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'INVITE_REQUIRED' });

    const { res: ok, body } = await signIn('sub-route-1');
    expect(ok.status).toBe(201);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(body).toMatchObject({ expiresIn: 900, device: { id: expect.any(String) }, user: { id: expect.any(String) }, learner: { id: expect.any(String) } });
    expect(body.accessToken).toMatch(/^eyJ/);
    expect(body.refreshToken).toMatch(/^ipr_/);
  });

  it('an unverifiable Apple token is a 400 INVALID_APPLE_TOKEN, and unknown fields or both codes are validation errors', async () => {
    const bad = await routes.apple.POST(json('/api/auth/native/apple', { identityToken: 'forged-token-forged-token', nonce: 'nonce-abcdefgh', device: { platform: 'ios' } }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe('INVALID_APPLE_TOKEN');
    const extra = await routes.apple.POST(json('/api/auth/native/apple', { identityToken: 'tok:x-x-x-x-x-x-x-x-x-x', nonce: 'nonce-abcdefgh', device: { platform: 'ios' }, learnerId: 'someone' }));
    expect(extra.status).toBe(400);
  });

  it('push then pull: events are created once, retried as duplicates, and another device pulls the same history', async () => {
    const { body: phone } = await signIn('sub-route-2');
    const e1 = evt();
    const e2 = evt({ prompt: { text: 'Second prompt' } });
    const push = await routes.events.POST(json('/api/sync/events', { deviceClockAtSend: new Date().toISOString(), events: [e1, e2] }, bearer(phone.accessToken)));
    expect(push.status).toBe(200);
    const pushed = await push.json();
    expect(pushed.results.map((r: { status: string }) => r.status)).toEqual(['created', 'created']);
    expect(pushed.results[0]).toMatchObject({ eventId: e1.eventId, linkage: 'unlinked', evaluation: { state: 'not_evaluated' }, code: null });

    const retry = await (await routes.events.POST(json('/api/sync/events', { events: [e1, e2] }, bearer(phone.accessToken)))).json();
    expect(retry.results.map((r: { status: string }) => r.status)).toEqual(['duplicate', 'duplicate']);

    // The same account signs in on an iPad: no invite needed, a new device, the same history.
    const { body: ipad } = await signIn('sub-route-2', { inviteCode: undefined });
    expect(ipad.device.id).not.toBe(phone.device.id);
    expect(ipad.learner.id).toBe(phone.learner.id);
    const pull = await (await routes.changes.GET(get('/api/sync/changes?limit=1', bearer(ipad.accessToken)))).json();
    expect(pull.hasMore).toBe(true);
    expect(pull.changes).toHaveLength(1);
    const rest = await (await routes.changes.GET(get(`/api/sync/changes?limit=10&cursor=${encodeURIComponent(pull.nextCursor)}`, bearer(ipad.accessToken)))).json();
    const ids = [...pull.changes, ...rest.changes].map((c: { data: { clientEventId: string } }) => c.data.clientEventId);
    expect(ids).toEqual([e1.eventId, e2.eventId]);
    expect(rest.hasMore).toBe(false);
    expect(pull.changes[0].data.evaluation.state).toBe('not_evaluated');
    const done = await (await routes.changes.GET(get(`/api/sync/changes?cursor=${encodeURIComponent(rest.nextCursor)}`, bearer(ipad.accessToken)))).json();
    expect(done.changes).toHaveLength(0);
  });

  it('pull errors are stable: a malformed cursor is 400, and a reset epoch is 409 with the new epoch', async () => {
    const { body } = await signIn('sub-route-3');
    const bad = await routes.changes.GET(get('/api/sync/changes?cursor=garbage', bearer(body.accessToken)));
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe('INVALID_CURSOR');
    const first = await (await routes.changes.GET(get('/api/sync/changes', bearer(body.accessToken)))).json();
    await t.owner.syncEpoch.update({ where: { id: 1 }, data: { epoch: 7 } });
    const res = await routes.changes.GET(get(`/api/sync/changes?cursor=${encodeURIComponent(first.nextCursor)}`, bearer(body.accessToken)));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'EPOCH_CHANGED', details: { epoch: 7 } });
    await t.owner.syncEpoch.update({ where: { id: 1 }, data: { epoch: 1 } });
  });

  it('batch rules: more than 50 events or an empty batch is a 400, and the body size is capped', async () => {
    const { body } = await signIn('sub-route-4');
    const many = await routes.events.POST(json('/api/sync/events', { events: Array.from({ length: 51 }, () => evt()) }, bearer(body.accessToken)));
    expect(many.status).toBe(400);
    expect((await many.json()).code).toBe('INVALID_BATCH');
    expect((await routes.events.POST(json('/api/sync/events', { events: [] }, bearer(body.accessToken)))).status).toBe(400);
    const huge = await routes.events.POST(json('/api/sync/events', { events: [evt({ evidence: { transcript: 'x'.repeat(2_100_000), transcriber: 'a' } })] }, bearer(body.accessToken)));
    expect(huge.status).toBe(413);
  });

  describe('credential boundaries', () => {
    it('the sync routes refuse no token, a web cookie, a web JWT as Bearer, a machine token and a forged token', async () => {
      const { userId } = await makeUser(t.owner, 'web-boundary', { email: 'wb@example.com' });
      const machine = generateMachineToken();
      const principalLearner = await makeUser(t.owner, 'mp-owner');
      await t.owner.machinePrincipal.create({ data: { name: 'mcp-write', tokenHash: hashMachineToken(machine), tokenPrefix: machine.slice(0, 8), scopes: ['sessions:write', 'sessions:read'], userId: principalLearner.userId, learnerId: principalLearner.learnerId } });
      const attempts: Array<[string, Record<string, string>]> = [
        ['none', {}],
        ['web cookie', cookie(userId)],
        ['web jwt as bearer', bearer(generateToken(userId))],
        ['machine principal', bearer(machine)],
        ['forged', bearer('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.sig')],
      ];
      for (const [label, headers] of attempts) {
        const push = await routes.events.POST(json('/api/sync/events', { events: [evt()] }, headers));
        const pull = await routes.changes.GET(get('/api/sync/changes', headers));
        expect([label, push.status]).toEqual([label, 401]);
        expect([label, pull.status]).toEqual([label, 401]);
      }
    });

    it('a native access token does not authenticate on the web or machine routes', async () => {
      const { body } = await signIn('sub-route-5');
      for (const call of [
        () => routes.banks.GET(get('/api/banks', bearer(body.accessToken))),
        () => routes.deletion.POST(json('/api/account/deletion', {}, { ...bearer(generateToken('someone')) })),
      ]) {
        expect((await call()).status).toBe(401);
      }
    });

    it('refresh: rotation works, reuse revokes the device, and a revoked device cannot push', async () => {
      const { body } = await signIn('sub-route-6');
      const r1 = await routes.refresh.POST(json('/api/auth/native/refresh', { refreshToken: body.refreshToken }));
      expect(r1.status).toBe(200);
      const next = await r1.json();
      const reuse = await routes.refresh.POST(json('/api/auth/native/refresh', { refreshToken: body.refreshToken }));
      expect(reuse.status).toBe(401);
      expect((await reuse.json()).code).toBe('TOKEN_REUSED');
      const push = await routes.events.POST(json('/api/sync/events', { events: [evt()] }, bearer(next.accessToken)));
      expect(push.status).toBe(401); // the access token of the revoked device is dead too
      expect((await routes.refresh.POST(json('/api/auth/native/refresh', { refreshToken: next.refreshToken }))).status).toBe(401);
    });

    it('logout revokes the device immediately', async () => {
      const { body } = await signIn('sub-route-7');
      expect((await routes.logout.POST(json('/api/auth/native/logout', {}, bearer(body.accessToken)))).status).toBe(200);
      expect((await routes.events.POST(json('/api/sync/events', { events: [evt()] }, bearer(body.accessToken)))).status).toBe(401);
      expect((await routes.refresh.POST(json('/api/auth/native/refresh', { refreshToken: body.refreshToken }))).status).toBe(401);
    });

    it('clients below the minimum build are told to update (426) on sign-in and sync', async () => {
      const { body } = await signIn('sub-route-8');
      process.env.NATIVE_MIN_CLIENT_BUILD = '40';
      try {
        const push = await routes.events.POST(json('/api/sync/events', { events: [evt()] }, { ...bearer(body.accessToken), 'x-iprep-client': 'ios/1.0 (39)' }));
        expect(push.status).toBe(426);
        expect((await push.json()).code).toBe('CLIENT_TOO_OLD');
        const ok = await routes.events.POST(json('/api/sync/events', { events: [evt()] }, { ...bearer(body.accessToken), 'x-iprep-client': 'ios/1.0 (40)' }));
        expect(ok.status).toBe(200);
        const signin = await routes.apple.POST(json('/api/auth/native/apple', { identityToken: tokenFor('sub-route-8'), nonce: 'nonce-abcdefgh', device: { platform: 'ios' } }, { 'x-iprep-client': 'ios/1.0 (1)' }));
        expect(signin.status).toBe(426);
      } finally {
        delete process.env.NATIVE_MIN_CLIENT_BUILD;
      }
    });
  });

  describe('account link and deletion over HTTP', () => {
    it('a signed-in web user creates a link code and links Apple with it', async () => {
      const { userId, learnerId } = await makeUser(t.owner, 'web-link', { email: 'wl@example.com' });
      const res = await routes.linkCode.POST(json('/api/account/apple-link-code', {}, cookie(userId)));
      expect(res.status).toBe(200);
      const { code, expiresAt } = await res.json();
      expect(code).toMatch(/^LINK-/);
      expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
      const { res: linked, body } = await signIn('sub-linked', { linkCode: code });
      expect(linked.status).toBe(200);
      expect(body).toMatchObject({ user: { id: userId }, learner: { id: learnerId } });
      expect((await routes.linkCode.POST(json('/api/account/apple-link-code', {}, {}))).status).toBe(401); // signed-in humans only
    });

    it('requesting deletion from the app revokes the device and blocks everything; signing in with cancelDeletion restores it', async () => {
      const { body } = await signIn('sub-del-route');
      const res = await routes.deletion.POST(json('/api/account/deletion', {}, bearer(body.accessToken)));
      expect(res.status).toBe(200);
      const out = await res.json();
      expect(out.state).toBe('DELETION_PENDING');
      const days = (new Date(out.purgeAfter).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThan(30.1);
      expect((await routes.events.POST(json('/api/sync/events', { events: [evt()] }, bearer(body.accessToken)))).status).toBe(401);
      const blocked = await routes.apple.POST(json('/api/auth/native/apple', { identityToken: tokenFor('sub-del-route'), nonce: 'nonce-abcdefgh', device: { platform: 'ios' } }));
      expect(blocked.status).toBe(403);
      expect(await blocked.json()).toMatchObject({ code: 'ACCOUNT_DELETION_PENDING', details: { purgeAfter: out.purgeAfter } });
      const back = await routes.apple.POST(json('/api/auth/native/apple', { identityToken: tokenFor('sub-del-route'), nonce: 'nonce-abcdefgh', cancelDeletion: true, device: { platform: 'ios' } }));
      expect(back.status).toBe(200);
    });

    it('a web user requesting deletion loses web access too (403 ACCOUNT_DELETION_PENDING)', async () => {
      const { userId } = await makeUser(t.owner, 'web-del', { email: 'wd@example.com' });
      expect((await routes.deletion.POST(json('/api/account/deletion', {}, cookie(userId)))).status).toBe(200);
      const after = await routes.banks.GET(get('/api/banks', cookie(userId)));
      expect(after.status).toBe(403);
      expect((await after.json()).code).toBe('ACCOUNT_DELETION_PENDING');
    });

    it('a machine principal cannot request deletion for its learner', async () => {
      const mp = await makeUser(t.owner, 'mp-del');
      const token = generateMachineToken();
      await t.owner.machinePrincipal.create({ data: { name: 'del-probe', tokenHash: hashMachineToken(token), tokenPrefix: token.slice(0, 8), scopes: ['sessions:write'], userId: mp.userId, learnerId: mp.learnerId } });
      expect((await routes.deletion.POST(json('/api/account/deletion', {}, bearer(token)))).status).toBe(401);
      expect((await t.owner.user.findUniqueOrThrow({ where: { id: mp.userId } })).deletionRequestedAt).toBeNull();
    });

    it('a pending account also loses machine-principal access', async () => {
      const mp = await makeUser(t.owner, 'mp-pending');
      const token = generateMachineToken();
      await t.owner.machinePrincipal.create({ data: { name: 'pend-probe', tokenHash: hashMachineToken(token), tokenPrefix: token.slice(0, 8), scopes: ['banks:read'], userId: mp.userId, learnerId: mp.learnerId } });
      expect((await routes.banks.GET(get('/api/banks', bearer(token)))).status).toBe(200);
      await t.owner.user.update({ where: { id: mp.userId }, data: { deletionRequestedAt: new Date(), purgeAfter: new Date(Date.now() + 86_400_000) } });
      expect((await routes.banks.GET(get('/api/banks', bearer(token)))).status).toBe(403);
    });
  });

  describe('Apple server notifications', () => {
    it('a consent-revoked notification signs the account out everywhere; garbage is a 400', async () => {
      const { body } = await signIn('sub-notify');
      const bad = await routes.notify.POST(json('/api/auth/native/apple/notifications', { payload: 'garbage' }));
      expect(bad.status).toBe(400);
      expect((await routes.notify.POST(json('/api/auth/native/apple/notifications', {}))).status).toBe(400);
      const ok = await routes.notify.POST(json('/api/auth/native/apple/notifications', { payload: 'evt:consent-revoked:sub-notify' }));
      expect(ok.status).toBe(200);
      expect((await routes.events.POST(json('/api/sync/events', { events: [evt()] }, bearer(body.accessToken)))).status).toBe(401);
    });
  });

  describe('content over HTTP', () => {
    it('custom bank import is idempotent and returns the mapping; identity-preserving question writes hide archived questions', async () => {
      const { body } = await signIn('sub-route-9');
      const payload = { bankKey: 'custom-http', title: 'HTTP bank', questions: [{ questionKey: 'a', text: 'Question A?' }, { questionKey: 'b', text: 'Question B?' }] };
      const first = await (await routes.bankImport.POST(json('/api/sync/banks/import', payload, bearer(body.accessToken)))).json();
      expect(first.created).toBe(true);
      expect(first.questions.map((q: { status: string }) => q.status)).toEqual(['created', 'created']);
      expect(first.questions.every((q: { revisionId: string }) => q.revisionId.length > 0)).toBe(true);
      const again = await (await routes.bankImport.POST(json('/api/sync/banks/import', payload, bearer(body.accessToken)))).json();
      expect(again.created).toBe(false);
      expect(again.bankId).toBe(first.bankId);
      expect(again.questions.map((q: { questionId: string }) => q.questionId)).toEqual(first.questions.map((q: { questionId: string }) => q.questionId));
      expect(again.questions.map((q: { status: string }) => q.status)).toEqual(['existing', 'existing']);

      // The owner (a web session) rewrites the list with PUT: ids are kept, the missing question is archived.
      const owner = body.user.id as string;
      const put = await routes.questions.PUT(json(`/api/banks/${first.bankId}/questions`, { questions: [{ externalKey: 'b', text: 'Question B?' }] }, cookie(owner)), { params: Promise.resolve({ id: first.bankId }) });
      expect(put.status).toBe(200);
      const res = await put.json();
      expect(res.questionCount).toBe(1);
      expect(res.questions[0].id).toBe(first.questions[1].questionId);
      const archived = await t.owner.question.findUniqueOrThrow({ where: { id: first.questions[0].questionId } });
      expect(archived.archivedAt).not.toBeNull();
      const bank = await (await routes.bank.GET(get(`/api/banks/${first.bankId}`, cookie(owner)), { params: Promise.resolve({ id: first.bankId }) })).json();
      expect(bank.questions.map((q: { id: string }) => q.id)).toEqual([first.questions[1].questionId]);
    });

    it('another user cannot write to a bank they do not own', async () => {
      const other = await makeUser(t.owner, 'web-other', { email: 'other@example.com' });
      const bank = await t.owner.questionBank.findFirstOrThrow({ where: { externalKey: 'custom-http' } });
      const res = await routes.questions.POST(json(`/api/banks/${bank.id}/questions`, { questions: [{ text: 'Injected?' }] }, cookie(other.userId)), { params: Promise.resolve({ id: bank.id }) });
      expect(res.status).toBe(404);
    });
  });
});
