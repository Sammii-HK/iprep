/**
 * Sign in with Apple, verified on the server. The fetch of Apple's public keys uses a fixed URL constant (never a
 * value from a request). Verification checks signature, issuer, audience (our bundle id), expiry and the nonce.
 */
import { createHash, createPublicKey, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';

export const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
export const DEFAULT_APPLE_AUDIENCE = 'app.lunary.iprep';

export function appleAudience(): string {
  return process.env.APPLE_CLIENT_ID || DEFAULT_APPLE_AUDIENCE;
}

export interface AppleJwk {
  kty: string;
  kid: string;
  use?: string;
  alg?: string;
  n: string;
  e: string;
}

export type JwksFetcher = () => Promise<{ keys: AppleJwk[] }>;

const defaultFetcher: JwksFetcher = async () => {
  const res = await fetch(APPLE_KEYS_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Apple keys request failed (${res.status})`);
  return (await res.json()) as { keys: AppleJwk[] };
};

let cache: { keys: AppleJwk[]; at: number } | null = null;
const CACHE_MS = 60 * 60 * 1000;

export function resetAppleKeyCache(): void {
  cache = null;
}

async function keyFor(kid: string, fetcher: JwksFetcher): Promise<AppleJwk | null> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    const hit = cache.keys.find((k) => k.kid === kid);
    if (hit) return hit;
  }
  // Unknown kid or stale cache: refresh once (Apple rotates keys).
  const fresh = await fetcher();
  cache = { keys: fresh.keys, at: now };
  return fresh.keys.find((k) => k.kid === kid) ?? null;
}

export interface AppleIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
}

export class AppleVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppleVerificationError';
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** The raw nonce the app generated must hash to the nonce claim Apple embedded in the token. */
export function nonceMatches(rawNonce: string, claim: unknown): boolean {
  if (typeof claim !== 'string' || !rawNonce) return false;
  const a = Buffer.from(sha256Hex(rawNonce));
  const b = Buffer.from(claim);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function verifyAppleJwt(token: string, fetcher: JwksFetcher): Promise<Record<string, unknown>> {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string' || decoded.header.alg !== 'RS256' || !decoded.header.kid) {
    throw new AppleVerificationError('Malformed token');
  }
  const jwk = await keyFor(decoded.header.kid, fetcher);
  if (!jwk) throw new AppleVerificationError('Unknown signing key');
  const key = createPublicKey({ key: jwk as unknown as import('crypto').JsonWebKey, format: 'jwk' });
  try {
    return jwt.verify(token, key, {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
      audience: appleAudience(),
    }) as Record<string, unknown>;
  } catch {
    throw new AppleVerificationError('Token failed verification');
  }
}

export async function verifyAppleIdentityToken(
  identityToken: string,
  rawNonce: string,
  fetcher: JwksFetcher = defaultFetcher
): Promise<AppleIdentity> {
  const claims = await verifyAppleJwt(identityToken, fetcher);
  if (typeof claims.sub !== 'string' || !claims.sub) throw new AppleVerificationError('No subject');
  if (!nonceMatches(rawNonce, claims.nonce)) throw new AppleVerificationError('Nonce mismatch');
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  return {
    subject: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    emailVerified,
  };
}

export type AppleServerEventType = 'consent-revoked' | 'account-delete' | 'email-disabled' | 'email-enabled';

export interface AppleServerEvent {
  type: AppleServerEventType;
  subject: string;
}

/** Apple's server-to-server notifications: a signed JWT whose `events` claim is a JSON string. */
export async function verifyAppleServerNotification(
  payload: string,
  fetcher: JwksFetcher = defaultFetcher
): Promise<AppleServerEvent> {
  const claims = await verifyAppleJwt(payload, fetcher);
  const raw = claims.events;
  let events: { type?: unknown; sub?: unknown };
  try {
    events = typeof raw === 'string' ? JSON.parse(raw) : (raw as typeof events);
  } catch {
    throw new AppleVerificationError('Malformed events');
  }
  const known: AppleServerEventType[] = ['consent-revoked', 'account-delete', 'email-disabled', 'email-enabled'];
  if (typeof events?.sub !== 'string' || !known.includes(events.type as AppleServerEventType)) {
    throw new AppleVerificationError('Unsupported event');
  }
  return { type: events.type as AppleServerEventType, subject: events.sub };
}
