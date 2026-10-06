import { describe, expect, it, vi } from 'vitest';
import { canAccessOwnedRecord, canReadBank, canWriteBank, isAdminRole, ownsRecord } from '@/lib/access';
import { canonicalEmail } from '@/lib/email';
import {
  MACHINE_SCOPES,
  PRINCIPAL_PRESETS,
  generateMachineToken,
  hasScope,
  hashMachineToken,
  isMachineToken,
  safeEqualHex,
  validScopes,
} from '@/lib/machine-auth';
import { PushSubscriptionSchema, isAllowedPushEndpoint } from '@/lib/push-validation';
import { MemoryRateLimitStore, clientIp, enforceRateLimit } from '@/lib/rate-limit';

describe('canonical email', () => {
  it('lowercases and trims so case variants are one identity', () => {
    expect(canonicalEmail('  Admin@Example.COM ')).toBe('admin@example.com');
    expect(canonicalEmail('ADMIN@example.com')).toBe(canonicalEmail('admin@EXAMPLE.com'));
  });
});

describe('ownership: null-owner data is never world-writable', () => {
  const owner = { id: 'u1', role: 'USER' };
  const other = { id: 'u2', role: 'USER' };
  const admin = { id: 'a1', role: 'ADMIN' };

  it('ownsRecord is an explicit equality; null never matches', () => {
    expect(ownsRecord({ userId: 'u1' }, owner)).toBe(true);
    expect(ownsRecord({ userId: 'u1' }, other)).toBe(false);
    expect(ownsRecord({ userId: null }, owner)).toBe(false);
    expect(ownsRecord({ userId: null }, admin)).toBe(false);
  });

  it('sessions and quizzes: owner only; an orphan (no owner) is admin-only repair', () => {
    expect(canAccessOwnedRecord({ userId: 'u1' }, owner)).toBe(true);
    expect(canAccessOwnedRecord({ userId: 'u1' }, other)).toBe(false);
    expect(canAccessOwnedRecord({ userId: 'u1' }, admin)).toBe(false); // admin is not a bypass for user data
    expect(canAccessOwnedRecord({ userId: null }, other)).toBe(false);
    expect(canAccessOwnedRecord({ userId: null }, admin)).toBe(true);
  });

  it('banks: shared content is readable by any signed-in user but writable only by an admin', () => {
    expect(canReadBank({ userId: null }, other)).toBe(true);
    expect(canWriteBank({ userId: null }, other)).toBe(false);
    expect(canWriteBank({ userId: null }, admin)).toBe(true);
  });

  it('banks: a private bank is only for its owner', () => {
    expect(canReadBank({ userId: 'u1' }, other)).toBe(false);
    expect(canWriteBank({ userId: 'u1' }, other)).toBe(false);
    expect(canWriteBank({ userId: 'u1' }, admin)).toBe(false);
    expect(canWriteBank({ userId: 'u1' }, owner)).toBe(true);
  });

  it('admin is only the stored role', () => {
    expect(isAdminRole({ role: 'ADMIN' })).toBe(true);
    expect(isAdminRole({ role: 'USER' })).toBe(false);
  });
});

describe('push endpoint validation (no SSRF, no relay)', () => {
  const keys = { p256dh: 'B'.repeat(65), auth: 'a'.repeat(22) };

  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])('accepts a real browser push service: %s', (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(true);
    expect(PushSubscriptionSchema.safeParse({ endpoint: url, keys }).success).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc', // not https
    'https://169.254.169.254/latest/meta-data/', // cloud metadata
    'https://127.0.0.1/', // loopback
    'https://localhost/', // internal name
    'https://[::1]/', // ipv6 loopback
    'https://10.0.0.5/', // private ip
    'https://internal.service.local/hook',
    'https://fcm.googleapis.com.evil.com/', // look-alike suffix
    'https://evil.com/fcm.googleapis.com', // allowed name only in the path
    'https://user:pass@fcm.googleapis.com/', // credentials
    'https://fcm.googleapis.com:8443/', // non-default port
    'https://fcm.googleapis.com./', // trailing dot
    'https://notify.windows.com.evil.com/',
    'https://.notify.windows.com/',
    'file:///etc/passwd',
    'gopher://fcm.googleapis.com/',
    'javascript:alert(1)',
    'not a url',
    '',
  ])('rejects %s', (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(false);
    expect(PushSubscriptionSchema.safeParse({ endpoint: url, keys }).success).toBe(false);
  });

  it('rejects keys that are not base64url', () => {
    expect(PushSubscriptionSchema.safeParse({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: '<script>'.repeat(4), auth: 'a'.repeat(22) } }).success).toBe(false);
  });
});

describe('durable rate limiting', () => {
  it('allows up to the limit then refuses, per key', async () => {
    const store = new MemoryRateLimitStore();
    const opts = { key: 'k', limit: 3, windowMs: 60_000, store, now: 1_000_000 };
    for (let i = 0; i < 3; i++) await expect(enforceRateLimit(opts)).resolves.toBeUndefined();
    await expect(enforceRateLimit(opts)).rejects.toMatchObject({ statusCode: 429 });
    await expect(enforceRateLimit({ ...opts, key: 'other' })).resolves.toBeUndefined();
  });

  it('resets in the next window', async () => {
    const store = new MemoryRateLimitStore();
    const base = { key: 'k', limit: 1, windowMs: 1000, store };
    await enforceRateLimit({ ...base, now: 10_000 });
    await expect(enforceRateLimit({ ...base, now: 10_500 })).rejects.toMatchObject({ statusCode: 429 });
    await expect(enforceRateLimit({ ...base, now: 11_200 })).resolves.toBeUndefined();
  });

  it('fails closed by default when the store is unavailable (503), never silently allowing', async () => {
    const broken = { hit: vi.fn().mockRejectedValue(new Error('db down')) };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(enforceRateLimit({ key: 'k', limit: 5, windowMs: 1000, store: broken })).rejects.toMatchObject({ statusCode: 503 });
  });

  it('fail-open is explicit and opt-in', async () => {
    const broken = { hit: vi.fn().mockRejectedValue(new Error('db down')) };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(enforceRateLimit({ key: 'k', limit: 5, windowMs: 1000, store: broken, failClosed: false })).resolves.toBeUndefined();
  });

  it('uses only platform-set IP headers, never a client-extendable X-Forwarded-For', () => {
    const req = (h: Record<string, string>) => ({ headers: new Headers(h) });
    expect(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4' }))).toBe('unknown');
    expect(clientIp(req({ 'x-vercel-forwarded-for': '1.2.3.4', 'x-forwarded-for': '6.6.6.6' }))).toBe('1.2.3.4');
    expect(clientIp(req({ 'x-real-ip': '5.6.7.8' }))).toBe('5.6.7.8');
  });
});

describe('machine tokens', () => {
  it('are random, prefixed, and stored only as a hash', () => {
    const a = generateMachineToken();
    const b = generateMachineToken();
    expect(a).not.toBe(b);
    expect(isMachineToken(a)).toBe(true);
    expect(isMachineToken('eyJhbGciOiJIUzI1NiJ9.x.y')).toBe(false); // a user JWT is not a machine token
    expect(hashMachineToken(a)).toHaveLength(64);
    expect(hashMachineToken(a)).not.toContain(a);
    expect(safeEqualHex(hashMachineToken(a), hashMachineToken(a))).toBe(true);
    expect(safeEqualHex(hashMachineToken(a), hashMachineToken(b))).toBe(false);
    expect(safeEqualHex('', '')).toBe(false);
  });

  it('presets contain only known scopes and no admin-like capability', () => {
    for (const [name, scopes] of Object.entries(PRINCIPAL_PRESETS)) {
      expect(validScopes([...scopes]), name).toBe(true);
      expect([...scopes].every((s) => (MACHINE_SCOPES as readonly string[]).includes(s)), name).toBe(true);
    }
    expect(MACHINE_SCOPES.some((s) => /admin/i.test(s))).toBe(false);
  });

  it('presets are the smallest sets the audited consumers need', () => {
    expect(PRINCIPAL_PRESETS['notion-sync']).toEqual(['interviews:sync', 'folders:read']);
    expect(PRINCIPAL_PRESETS['facts-seed']).toEqual(['facts:write']);
    expect(PRINCIPAL_PRESETS['audio-tools']).toEqual(['folders:read', 'banks:read']);
    expect(hasScope(PRINCIPAL_PRESETS['mcp-read'], 'banks:write')).toBe(false);
    expect(hasScope(PRINCIPAL_PRESETS['mcp-write'], 'interviews:sync')).toBe(false);
  });
});
