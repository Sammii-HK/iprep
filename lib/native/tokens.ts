/**
 * Native (iOS) tokens. Deliberately separate from the web cookie JWT:
 *  - a different signing key (derived from the same secret with a purpose label), and
 *  - a distinct issuer and audience,
 * so a web token can never authenticate as a native token and a native token can never authenticate on the web.
 * Access tokens are short-lived and bound to a device. Refresh tokens are opaque, hashed at rest and single use.
 */
import { createHash, createHmac, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';

export const NATIVE_ISSUER = 'iprep';
export const NATIVE_AUDIENCE = 'iprep-native';
export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days; each use rotates it

export interface NativeAccessClaims {
  userId: string;
  deviceId: string;
}

/** A key that is not the web signing key, derived so no extra secret has to be configured. */
export function nativeSigningKey(secret: string): string {
  return createHmac('sha256', secret).update('iprep-native-access-v1').digest('hex');
}

export function signNativeAccessToken(claims: NativeAccessClaims, secret: string): string {
  return jwt.sign(
    { sub: claims.userId, did: claims.deviceId, typ: 'native-access' },
    nativeSigningKey(secret),
    {
      algorithm: 'HS256',
      issuer: NATIVE_ISSUER,
      audience: NATIVE_AUDIENCE,
      expiresIn: ACCESS_TTL_SECONDS,
      notBefore: 0,
    }
  );
}

export function verifyNativeAccessToken(token: string, secret: string): NativeAccessClaims | null {
  try {
    const decoded = jwt.verify(token, nativeSigningKey(secret), {
      algorithms: ['HS256'],
      issuer: NATIVE_ISSUER,
      audience: NATIVE_AUDIENCE,
    }) as { sub?: unknown; did?: unknown; typ?: unknown };
    if (decoded.typ !== 'native-access' || typeof decoded.sub !== 'string' || typeof decoded.did !== 'string') return null;
    return { userId: decoded.sub, deviceId: decoded.did };
  } catch {
    return null;
  }
}

export const REFRESH_TOKEN_PREFIX = 'ipr_';

export function generateRefreshToken(): string {
  return `${REFRESH_TOKEN_PREFIX}${randomBytes(32).toString('hex')}`;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
