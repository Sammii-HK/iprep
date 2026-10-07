/**
 * Invite and link codes: short, human-typable, single-use, expiring. Only the SHA-256 of the normalised code is
 * stored, and the code is shown to its creator once. 10 random bytes (80 bits) make guessing infeasible; the
 * redemption endpoints are also rate-limited.
 */
import { createHash, randomBytes } from 'crypto';

// Crockford-style alphabet: no I, L, O, U (avoids 1/I and 0/O confusion).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encode(bytes: Buffer): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

function group(code: string, size: number): string {
  return code.match(new RegExp(`.{1,${size}}`, 'g'))!.join('-');
}

export function generateInviteCode(): string {
  return `IPREP-${group(encode(randomBytes(10)), 4)}`; // 16 chars -> IPREP-XXXX-XXXX-XXXX-XXXX
}

export function generateLinkCode(): string {
  return `LINK-${group(encode(randomBytes(5)), 4)}`; // 8 chars -> LINK-XXXX-XXXX (10 minute lifetime, rate-limited)
}

/** Case, whitespace and dash insensitive, with the visually ambiguous letters mapped as Crockford does. */
export function normaliseCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export function hashCode(input: string): string {
  return createHash('sha256').update(normaliseCode(input)).digest('hex');
}
