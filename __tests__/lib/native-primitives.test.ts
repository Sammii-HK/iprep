import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateToken, verifyToken } from '@/lib/auth';
import {
  AppleVerificationError,
  type AppleJwk,
  nonceMatches,
  resetAppleKeyCache,
  sha256Hex,
  verifyAppleIdentityToken,
  verifyAppleServerNotification,
} from '@/lib/native/apple';
import { generateInviteCode, generateLinkCode, hashCode, normaliseCode } from '@/lib/native/codes';
import { NATIVE_AUDIENCE, generateRefreshToken, hashToken, nativeSigningKey, signNativeAccessToken, verifyNativeAccessToken } from '@/lib/native/tokens';
import { AttemptCreatedSchema, canonicalPayloadHash, measureSkew, stableStringify } from '@/lib/sync/events';
import { assertClientSupported, clientBuild } from '@/lib/native/auth';
import { NextRequest } from 'next/server';

const SECRET = 'test-secret-key-for-testing-only';

// The web helpers read the signing secret through getConfig; give this file one.
process.env.JWT_SECRET = SECRET;

describe('native and web tokens cannot be confused', () => {
  it('a native access token verifies as native and never as a web token', () => {
    const native = signNativeAccessToken({ userId: 'u1', deviceId: 'd1' }, SECRET);
    expect(verifyNativeAccessToken(native, SECRET)).toEqual({ userId: 'u1', deviceId: 'd1' });
    expect(verifyToken(native)).toBeNull();
  });

  it('a web token never verifies as a native token', () => {
    const web = generateToken('u1');
    expect(verifyNativeAccessToken(web, SECRET)).toBeNull();
  });

  it('rejects a token signed with the right key but the wrong audience, issuer, type or algorithm', () => {
    const key = nativeSigningKey(SECRET);
    const bad = (claims: object, opts: jwt.SignOptions) => jwt.sign(claims, key, { algorithm: 'HS256', expiresIn: 60, ...opts });
    expect(verifyNativeAccessToken(bad({ sub: 'u', did: 'd', typ: 'native-access' }, { issuer: 'iprep', audience: 'someone-else' }), SECRET)).toBeNull();
    expect(verifyNativeAccessToken(bad({ sub: 'u', did: 'd', typ: 'native-access' }, { issuer: 'other', audience: NATIVE_AUDIENCE }), SECRET)).toBeNull();
    expect(verifyNativeAccessToken(bad({ sub: 'u', did: 'd', typ: 'refresh' }, { issuer: 'iprep', audience: NATIVE_AUDIENCE }), SECRET)).toBeNull();
    expect(verifyNativeAccessToken(bad({ sub: 'u', did: 'd', typ: 'native-access' }, { issuer: 'iprep', audience: NATIVE_AUDIENCE, algorithm: 'HS512' }), SECRET)).toBeNull();
    expect(verifyNativeAccessToken(jwt.sign({ sub: 'u', did: 'd', typ: 'native-access' }, '', { algorithm: 'none' as never }), SECRET)).toBeNull();
  });

  it('expired tokens and tokens from another deployment secret are refused', () => {
    const expired = jwt.sign({ sub: 'u', did: 'd', typ: 'native-access' }, nativeSigningKey(SECRET), {
      algorithm: 'HS256', issuer: 'iprep', audience: NATIVE_AUDIENCE, expiresIn: -10,
    });
    expect(verifyNativeAccessToken(expired, SECRET)).toBeNull();
    expect(verifyNativeAccessToken(signNativeAccessToken({ userId: 'u', deviceId: 'd' }, 'another-secret'), SECRET)).toBeNull();
  });

  it('refresh tokens are opaque, long, and only their hash is derived for storage', () => {
    const t = generateRefreshToken();
    expect(t).toMatch(/^ipr_[0-9a-f]{64}$/);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
    expect(generateRefreshToken()).not.toBe(t);
  });
});

describe('invite and link codes', () => {
  it('have the documented shape and are high entropy', () => {
    expect(generateInviteCode()).toMatch(/^IPREP-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(generateLinkCode()).toMatch(/^LINK-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(new Set(Array.from({ length: 200 }, generateInviteCode)).size).toBe(200);
  });

  it('hash the same however a human types them, and different codes hash differently', () => {
    const code = generateInviteCode();
    expect(hashCode(code.toLowerCase())).toBe(hashCode(code));
    expect(hashCode(code.replace(/-/g, ' '))).toBe(hashCode(code));
    expect(hashCode(generateInviteCode())).not.toBe(hashCode(code));
    expect(normaliseCode('iprep-0o1i-lL')).toBe('1PREP001111'); // I and L read as 1, O as 0, like Crockford base32
    expect(hashCode(code)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Sign in with Apple verification', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'test-kid', use: 'sig', alg: 'RS256' } as AppleJwk;
  const fetcher = async () => ({ keys: [jwk] });
  const nonce = 'raw-nonce-abcdef';
  const sign = (claims: Record<string, unknown>, opts: jwt.SignOptions = {}) =>
    jwt.sign(claims, privateKey, { algorithm: 'RS256', keyid: 'test-kid', expiresIn: 600, issuer: 'https://appleid.apple.com', audience: 'app.lunary.iprep', ...opts });

  beforeEach(() => resetAppleKeyCache());

  it('accepts a valid token with the matching nonce', async () => {
    const id = await verifyAppleIdentityToken(sign({ sub: 'apple-sub-1', nonce: sha256Hex(nonce), email: 'a@privaterelay.appleid.com', email_verified: 'true' }), nonce, fetcher);
    expect(id).toEqual({ subject: 'apple-sub-1', email: 'a@privaterelay.appleid.com', emailVerified: true });
  });

  it('rejects wrong nonce, missing nonce, wrong audience, wrong issuer, expired, unknown key and tampering', async () => {
    const ok = { sub: 's', nonce: sha256Hex(nonce) };
    await expect(verifyAppleIdentityToken(sign(ok), 'a-different-nonce', fetcher)).rejects.toBeInstanceOf(AppleVerificationError);
    await expect(verifyAppleIdentityToken(sign({ sub: 's' }), nonce, fetcher)).rejects.toBeInstanceOf(AppleVerificationError);
    await expect(verifyAppleIdentityToken(sign(ok, { audience: 'com.someone.else' }), nonce, fetcher)).rejects.toBeInstanceOf(AppleVerificationError);
    await expect(verifyAppleIdentityToken(sign(ok, { issuer: 'https://evil.example' }), nonce, fetcher)).rejects.toBeInstanceOf(AppleVerificationError);
    await expect(verifyAppleIdentityToken(sign(ok, { expiresIn: -5 }), nonce, fetcher)).rejects.toBeInstanceOf(AppleVerificationError);
    await expect(verifyAppleIdentityToken(sign(ok, { keyid: 'unknown-kid' }), nonce, fetcher)).rejects.toBeInstanceOf(AppleVerificationError);
    const tampered = sign(ok).split('.');
    tampered[1] = Buffer.from(JSON.stringify({ ...ok, sub: 'someone-else' })).toString('base64url');
    await expect(verifyAppleIdentityToken(tampered.join('.'), nonce, fetcher)).rejects.toBeInstanceOf(AppleVerificationError);
    await expect(verifyAppleIdentityToken('not-a-jwt', nonce, fetcher)).rejects.toBeInstanceOf(AppleVerificationError);
  });

  it('refuses an HS256 token even if it claims Apple as the issuer (algorithm confusion)', async () => {
    const forged = jwt.sign({ sub: 's', nonce: sha256Hex(nonce) }, 'x'.repeat(32), { algorithm: 'HS256', keyid: 'test-kid', issuer: 'https://appleid.apple.com', audience: 'app.lunary.iprep' });
    await expect(verifyAppleIdentityToken(forged, nonce, fetcher)).rejects.toBeInstanceOf(AppleVerificationError);
  });

  it('nonce comparison is on the SHA-256 of the raw nonce', () => {
    expect(nonceMatches(nonce, sha256Hex(nonce))).toBe(true);
    expect(nonceMatches(nonce, nonce)).toBe(false);
    expect(nonceMatches('', sha256Hex(''))).toBe(false);
  });

  it('parses and verifies server-to-server notifications', async () => {
    const events = JSON.stringify({ type: 'consent-revoked', sub: 'apple-sub-1', event_time: 1 });
    expect(await verifyAppleServerNotification(sign({ events }), fetcher)).toEqual({ type: 'consent-revoked', subject: 'apple-sub-1' });
    await expect(verifyAppleServerNotification(sign({ events: JSON.stringify({ type: 'something-else', sub: 'x' }) }), fetcher)).rejects.toBeInstanceOf(AppleVerificationError);
    await expect(verifyAppleServerNotification(sign({ events }, { audience: 'other' }), fetcher)).rejects.toBeInstanceOf(AppleVerificationError);
  });
});

describe('attempt event contract', () => {
  const base = {
    type: 'attempt.created' as const,
    schemaVersion: 1 as const,
    eventId: '7f0c8a52-3f0a-4d5e-9d3b-0a1b2c3d4e5f',
    origin: 'device' as const,
    surface: 'WRITTEN_TO_SPOKEN' as const,
    responseMode: 'SPOKEN' as const,
    occurredAt: '2026-10-07T18:41:03+01:00',
    prompt: { text: 'Explain closures.', clientRef: { bankKey: 'js', questionKey: 'q1' }, tags: ['js'] },
    evidence: { transcript: 'a closure keeps scope', transcriber: 'apple-sfspeech', words: 4 },
  };

  it('accepts a valid event and rejects every field a client must not author', () => {
    expect(AttemptCreatedSchema.safeParse(base).success).toBe(true);
    for (const extra of [{ learnerId: 'x' }, { userId: 'x' }, { evaluation: {} }, { evaluations: [] }, { measurements: [] }, { score: 9 }, { readiness: 1 }]) {
      expect(AttemptCreatedSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
    expect(AttemptCreatedSchema.safeParse({ ...base, prompt: { ...base.prompt, score: 9 } }).success).toBe(false);
    expect(AttemptCreatedSchema.safeParse({ ...base, evidence: { ...base.evidence, aiAnswerQuality: 8 } }).success).toBe(false);
  });

  it('rejects malformed events', () => {
    expect(AttemptCreatedSchema.safeParse({ ...base, eventId: 'not-a-uuid' }).success).toBe(false);
    expect(AttemptCreatedSchema.safeParse({ ...base, occurredAt: 'yesterday' }).success).toBe(false);
    expect(AttemptCreatedSchema.safeParse({ ...base, surface: 'LIVE_SPOKEN' }).success).toBe(false);
    expect(AttemptCreatedSchema.safeParse({ ...base, evidence: { ...base.evidence, transcript: '' } }).success).toBe(false);
    expect(AttemptCreatedSchema.safeParse({ ...base, prompt: { text: '' } }).success).toBe(false);
    expect(AttemptCreatedSchema.safeParse({ ...base, schemaVersion: 2 }).success).toBe(false);
  });

  it('the canonical hash ignores key order, timezone spelling, origin and null versus absent, but not content', () => {
    const h = canonicalPayloadHash(base);
    expect(canonicalPayloadHash({ ...base, origin: 'legacy-import' })).toBe(h);
    expect(canonicalPayloadHash({ ...base, occurredAt: '2026-10-07T17:41:03Z' })).toBe(h);
    expect(canonicalPayloadHash({ ...base, occurredAt: '2026-10-07T17:41:03.000+00:00' })).toBe(h);
    expect(canonicalPayloadHash({ ...base, evaluationRequested: undefined })).toBe(h);
    expect(canonicalPayloadHash({ ...base, prompt: { tags: ['js'], clientRef: { questionKey: 'q1', bankKey: 'js' }, text: 'Explain closures.' } })).toBe(h);
    expect(canonicalPayloadHash({ ...base, evidence: { ...base.evidence, transcript: 'different' } })).not.toBe(h);
    expect(canonicalPayloadHash({ ...base, occurredAt: '2026-10-07T18:41:04+01:00' })).not.toBe(h);
    expect(canonicalPayloadHash({ ...base, evaluationRequested: true })).not.toBe(h);
    expect(canonicalPayloadHash({ ...base, prompt: { ...base.prompt, text: 'Explain closures!' } })).not.toBe(h);
  });

  it('stableStringify is order independent', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });

  it('clock skew is measured and flagged, never applied', () => {
    const received = new Date('2026-10-07T12:00:00Z');
    expect(measureSkew(null, received, new Date('2026-10-07T11:00:00Z'))).toEqual({ skewMs: null, suspect: false });
    expect(measureSkew(new Date('2026-10-07T11:59:00Z'), received, new Date('2026-10-07T11:00:00Z'))).toEqual({ skewMs: 60_000, suspect: false });
    expect(measureSkew(new Date('2026-10-07T11:00:00Z'), received, new Date('2026-10-07T10:00:00Z')).suspect).toBe(true); // device an hour behind
    expect(measureSkew(new Date('2026-10-07T13:00:00Z'), received, new Date('2026-10-07T12:30:00Z')).suspect).toBe(true); // device ahead
    expect(measureSkew(new Date('2026-10-07T12:00:00Z'), received, new Date('2026-10-07T12:30:00Z')).suspect).toBe(true); // claims the future
  });
});

describe('client version gate', () => {
  it('parses the build and enforces the configured minimum', () => {
    expect(clientBuild('ios/1.4.0 (123)')).toBe(123);
    expect(clientBuild(null)).toBe(0);
    const req = (h?: string) => new NextRequest('http://localhost/x', { headers: h ? { 'x-iprep-client': h } : {} });
    delete process.env.NATIVE_MIN_CLIENT_BUILD;
    expect(() => assertClientSupported(req())).not.toThrow();
    process.env.NATIVE_MIN_CLIENT_BUILD = '50';
    expect(() => assertClientSupported(req('ios/1.0 (49)'))).toThrow(/update the app/i);
    expect(() => assertClientSupported(req('ios/1.0 (50)'))).not.toThrow();
    expect(() => assertClientSupported(req())).toThrow();
    delete process.env.NATIVE_MIN_CLIENT_BUILD;
  });
});
