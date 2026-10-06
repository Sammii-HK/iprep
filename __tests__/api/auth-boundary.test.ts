import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn() },
    machinePrincipal: { findUnique: vi.fn(), update: vi.fn() },
    machineAudit: { create: vi.fn() },
  },
}));
vi.mock('@/lib/config', () => ({
  getConfig: () => ({ jwt: { secret: 'test-secret-key-for-testing-only' }, admin: { email: 'boss@example.com' } }),
}));
vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(undefined),
  clientIp: () => '1.2.3.4',
  LIMITS: { register: { limit: 5, windowMs: 1 }, loginIp: { limit: 20, windowMs: 1 }, loginAccount: { limit: 8, windowMs: 1 } },
}));

import { prisma } from '@/lib/db';
import { generateToken, getCurrentUser, requireAccess, requireAdmin, requireAuth } from '@/lib/auth';
import { generateMachineToken, hashMachineToken } from '@/lib/machine-auth';
import { POST as register } from '@/app/api/auth/register/route';
import { POST as login } from '@/app/api/auth/login/route';

const db = vi.mocked(prisma, true);

function req(url: string, init: RequestInit & { headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, init as never);
}
function json(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return req(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

const adminLearner = { id: 'admin-1', email: 'boss@example.com', name: 'Boss', role: 'ADMIN', isPremium: true, emailVerified: true, createdAt: new Date() };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.REGISTRATION_ENABLED;
  delete process.env.REGISTRATION_INVITE_CODE;
  delete process.env.IPREP_INTERNAL_KEY;
});

describe('registration', () => {
  const body = { email: 'New@Example.com', password: 'password123' };

  it('is closed by default and creates nothing', async () => {
    const res = await register(json('/api/auth/register', body));
    expect(res.status).toBe(403);
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('stays closed when enabled without an invite code configured', async () => {
    process.env.REGISTRATION_ENABLED = 'true';
    const res = await register(json('/api/auth/register', { ...body, inviteCode: 'anything' }));
    expect(res.status).toBe(403);
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('refuses a wrong invite code', async () => {
    process.env.REGISTRATION_ENABLED = 'true';
    process.env.REGISTRATION_INVITE_CODE = 'correct-code';
    const res = await register(json('/api/auth/register', { ...body, inviteCode: 'wrong-code!' }));
    expect(res.status).toBe(403);
  });

  it('creates a USER with a canonical email when open and invited', async () => {
    process.env.REGISTRATION_ENABLED = 'true';
    process.env.REGISTRATION_INVITE_CODE = 'correct-code';
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue({ id: 'u9', email: 'new@example.com', name: null, role: 'USER', isPremium: false, createdAt: new Date() } as never);
    const res = await register(json('/api/auth/register', { ...body, inviteCode: 'correct-code' }));
    expect(res.status).toBe(200);
    const arg = db.user.create.mock.calls[0][0] as { data: { email: string; role: string; isPremium: boolean } };
    expect(arg.data.email).toBe('new@example.com');
    expect(arg.data.role).toBe('USER');
    expect(arg.data.isPremium).toBe(false);
    expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'new@example.com' } }));
  });

  it('can never assign ADMIN, even for a case variant of the admin email (the original takeover)', async () => {
    process.env.REGISTRATION_ENABLED = 'true';
    process.env.REGISTRATION_INVITE_CODE = 'correct-code';
    process.env.ADMIN_EMAIL = 'boss@example.com';
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue({ id: 'u9', email: 'boss@example.com', name: null, role: 'USER', isPremium: false, createdAt: new Date() } as never);
    await register(json('/api/auth/register', { email: 'BOSS@Example.com', password: 'password123', inviteCode: 'correct-code' }));
    const arg = db.user.create.mock.calls[0][0] as { data: { role: string; isPremium: boolean } };
    expect(arg.data.role).toBe('USER');
    expect(arg.data.isPremium).toBe(false);
    delete process.env.ADMIN_EMAIL;
  });

  it('a case variant of an existing account is a duplicate, not a second identity', async () => {
    process.env.REGISTRATION_ENABLED = 'true';
    process.env.REGISTRATION_INVITE_CODE = 'correct-code';
    db.user.findUnique.mockResolvedValue({ id: 'admin-1' } as never);
    const res = await register(json('/api/auth/register', { email: 'BOSS@EXAMPLE.COM', password: 'password123', inviteCode: 'correct-code' }));
    expect(res.status).toBe(400);
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'boss@example.com' } }));
  });

  it('rejects passwords bcrypt would silently truncate', async () => {
    process.env.REGISTRATION_ENABLED = 'true';
    process.env.REGISTRATION_INVITE_CODE = 'correct-code';
    const res = await register(json('/api/auth/register', { email: 'a@b.co', password: 'x'.repeat(80), inviteCode: 'correct-code' }));
    expect(res.status).toBe(400);
  });
});

describe('login', () => {
  it('looks the account up by canonical email', async () => {
    db.user.findUnique.mockResolvedValue(null);
    await login(json('/api/auth/login', { email: 'Boss@Example.COM', password: 'x' }));
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { email: 'boss@example.com' } });
  });

  it('unknown email and wrong password are indistinguishable, and both run a bcrypt comparison', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    const hash = await bcrypt.hash('right-password', 4);

    db.user.findUnique.mockResolvedValue(null);
    const unknown = await login(json('/api/auth/login', { email: 'nobody@example.com', password: 'whatever' }));
    const unknownCalls = compare.mock.calls.length;

    db.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.co', password: hash, role: 'USER' } as never);
    const wrong = await login(json('/api/auth/login', { email: 'a@b.co', password: 'wrong-password' }));

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await unknown.json()).toEqual(await wrong.json());
    expect(unknownCalls).toBeGreaterThanOrEqual(1); // an unknown account still pays the bcrypt cost
    expect(compare.mock.calls.length).toBeGreaterThan(unknownCalls);
  });
});

describe('machine principals and the old internal key', () => {
  function machine(overrides: Record<string, unknown> = {}) {
    const token = generateMachineToken();
    const row = {
      id: 'mp1',
      name: 'mcp-read',
      tokenHash: hashMachineToken(token),
      scopes: ['banks:read'],
      revokedAt: null,
      expiresAt: null,
      user: adminLearner,
      ...overrides,
    };
    db.machinePrincipal.findUnique.mockResolvedValue(row as never);
    db.machineAudit.create.mockResolvedValue({} as never);
    db.machinePrincipal.update.mockResolvedValue({} as never);
    return { token, row };
  }
  const withToken = (t: string, url = '/api/banks') => req(url, { headers: { authorization: `Bearer ${t}` } });

  it('the old x-internal-key header is ignored: it no longer authenticates anything', async () => {
    process.env.IPREP_INTERNAL_KEY = 'legacy-shared-secret';
    db.user.findUnique.mockResolvedValue(adminLearner as never);
    const r = req('/api/banks', { headers: { 'x-internal-key': 'legacy-shared-secret' } });
    await expect(requireAuth(r)).rejects.toMatchObject({ statusCode: 401 });
    await expect(requireAdmin(r)).rejects.toMatchObject({ statusCode: 401 });
    await expect(requireAccess(r, 'banks:read')).rejects.toMatchObject({ statusCode: 401 });
    expect(await getCurrentUser(r)).toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalled(); // and it never falls back to looking up "the admin" or "the first user"
  });

  it('a valid token with the scope acts as its learner, but never as admin', async () => {
    const { token } = machine();
    const ctx = await requireAccess(withToken(token), 'banks:read');
    expect(ctx.user.id).toBe('admin-1');
    expect(ctx.user.role).toBe('USER'); // the learner is an ADMIN, the principal is not
    expect(ctx.principal?.name).toBe('mcp-read');
    expect(db.machineAudit.create).toHaveBeenCalledWith({ data: expect.objectContaining({ scope: 'banks:read', status: 200 }) });
  });

  it('cannot exceed its scopes, and the refusal is audited', async () => {
    const { token } = machine({ scopes: ['banks:read'] });
    await expect(requireAccess(withToken(token), 'banks:write')).rejects.toMatchObject({ statusCode: 403, code: 'INSUFFICIENT_SCOPE' });
    expect(db.machineAudit.create).toHaveBeenCalledWith({ data: expect.objectContaining({ scope: 'banks:write', status: 403 }) });
  });

  it('refuses unknown, revoked and expired tokens', async () => {
    db.machinePrincipal.findUnique.mockResolvedValue(null);
    await expect(requireAccess(withToken(generateMachineToken()), 'banks:read')).rejects.toMatchObject({ statusCode: 401 });

    const revoked = machine({ revokedAt: new Date() });
    await expect(requireAccess(withToken(revoked.token), 'banks:read')).rejects.toMatchObject({ statusCode: 401 });

    const expired = machine({ expiresAt: new Date(Date.now() - 1000) });
    await expect(requireAccess(withToken(expired.token), 'banks:read')).rejects.toMatchObject({ statusCode: 401 });
  });

  it('a machine token never satisfies requireAuth, getCurrentUser or requireAdmin', async () => {
    const { token } = machine({ scopes: ['banks:read', 'banks:write', 'folders:write'] });
    expect(await getCurrentUser(withToken(token))).toBeNull();
    await expect(requireAuth(withToken(token))).rejects.toMatchObject({ statusCode: 401 });
    await expect(requireAdmin(withToken(token))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('a signed-in human passes requireAccess for any scope with their own role', async () => {
    db.user.findUnique.mockResolvedValue({ ...adminLearner, role: 'USER' } as never);
    const r = req('/api/banks', { headers: { cookie: `auth-token=${generateToken('admin-1')}` } });
    const ctx = await requireAccess(r, 'banks:write');
    expect(ctx.user.id).toBe('admin-1');
    expect(ctx.principal).toBeUndefined();
  });

  it('requireAdmin needs the stored role, from a human session', async () => {
    db.user.findUnique.mockResolvedValue({ ...adminLearner, role: 'USER' } as never);
    const r = req('/api/admin/users', { headers: { cookie: `auth-token=${generateToken('admin-1')}` } });
    await expect(requireAdmin(r)).rejects.toMatchObject({ statusCode: 403 });
    db.user.findUnique.mockResolvedValue(adminLearner as never);
    await expect(requireAdmin(r)).resolves.toMatchObject({ id: 'admin-1' });
  });
});
