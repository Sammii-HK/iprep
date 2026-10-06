/**
 * Machine principals: non-human credentials (MCP server, Notion sync, scripts, a custom GPT).
 *
 * - The token is a random bearer string, `ipm_<48 hex>`. Only its SHA-256 hash is stored.
 * - A principal acts as exactly one learner and holds an explicit list of scopes.
 * - A principal can be revoked or expire, and every use is audited.
 * - It can never be admin: the user it resolves to always has role USER, and it is accepted only by routes
 *   that ask for a scope with requireAccess(). Routes that use requireAuth() accept signed-in humans only.
 * - There is no fallback: an unknown, revoked or expired token is a 401, never "the first user" or "the admin".
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export const MACHINE_TOKEN_PREFIX = 'ipm_';

export const MACHINE_SCOPES = [
  'progress:read',
  'sessions:read',
  'sessions:write',
  'review:read',
  'insights:read',
  'banks:read',
  'banks:write',
  'folders:read',
  'folders:write',
  'interviews:sync',
  'facts:read',
  'facts:write',
] as const;

export type MachineScope = (typeof MACHINE_SCOPES)[number];

/** The consumers identified in the P0 audit and the smallest scope set each needs. */
export const PRINCIPAL_PRESETS: Record<string, readonly MachineScope[]> = {
  'mcp-read': ['progress:read', 'sessions:read', 'review:read', 'insights:read', 'banks:read', 'folders:read'],
  'mcp-write': [
    'progress:read',
    'sessions:read',
    'sessions:write',
    'review:read',
    'insights:read',
    'banks:read',
    'banks:write',
    'folders:read',
    'folders:write',
  ],
  'notion-sync': ['interviews:sync', 'folders:read'],
  'facts-seed': ['facts:write'],
  'audio-tools': ['folders:read', 'banks:read'],
};

export function isMachineToken(token: string | null | undefined): token is string {
  return typeof token === 'string' && token.startsWith(MACHINE_TOKEN_PREFIX);
}

export function generateMachineToken(): string {
  return `${MACHINE_TOKEN_PREFIX}${randomBytes(24).toString('hex')}`;
}

export function hashMachineToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

export function hasScope(scopes: readonly string[], required: MachineScope): boolean {
  return scopes.includes(required);
}

export function validScopes(scopes: readonly string[]): scopes is MachineScope[] {
  return scopes.every((s) => (MACHINE_SCOPES as readonly string[]).includes(s));
}
