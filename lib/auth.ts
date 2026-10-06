import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';
import { prisma } from './db';
import { getConfig } from './config';
import { AppError } from './errors';
import { isAdminRole } from './access';
import {
  type MachineScope,
  hasScope,
  hashMachineToken,
  isMachineToken,
  safeEqualHex,
} from './machine-auth';

const JWT_EXPIRES_IN = '7d';

function getJWTSecret(): string {
  return getConfig().jwt.secret;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** A real bcrypt hash of a random value, compared against when the account does not exist so that
 * "unknown email" and "wrong password" take the same time. */
const TIMING_DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', 10);

export async function verifyPasswordOrDummy(password: string, hash: string | null | undefined): Promise<boolean> {
  const ok = await bcrypt.compare(password, hash || TIMING_DUMMY_HASH);
  return Boolean(hash) && ok;
}

export function generateToken(userId: string): string {
  return jwt.sign({ userId }, getJWTSecret(), { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, getJWTSecret(), { algorithms: ['HS256'] }) as { userId: string };
    return decoded.userId;
  } catch {
    return null;
  }
}

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  isPremium: boolean;
  emailVerified: boolean;
  createdAt: Date;
}

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isPremium: true,
  emailVerified: true,
  createdAt: true,
} as const;

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = header.trim().match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/** The signed-in human from the session cookie or a user JWT. Machine tokens are never accepted here. */
export async function getCurrentUser(request: NextRequest): Promise<AuthUser | null> {
  try {
    const bearer = bearerToken(request);
    if (isMachineToken(bearer)) return null;

    const token = request.cookies.get('auth-token')?.value || bearer;
    if (!token) return null;

    const userId = verifyToken(token);
    if (!userId) return null;

    return await prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  } catch {
    return null;
  }
}

/** A signed-in human. Machine credentials do not satisfy this. */
export async function requireAuth(request: NextRequest): Promise<AuthUser> {
  const user = await getCurrentUser(request);
  if (!user) {
    throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  }
  return user;
}

/** A signed-in human whose stored role is ADMIN. The role is only ever set by a migration or script, never at registration. */
export async function requireAdmin(request: NextRequest): Promise<AuthUser> {
  const user = await requireAuth(request);
  if (!isAdminRole(user)) {
    throw new AppError('Admin access required', 403, 'ADMIN_ACCESS_REQUIRED');
  }
  return user;
}

export interface AccessContext {
  /** The learner the request acts as. For a machine principal the role is always USER. */
  user: AuthUser;
  principal?: { id: string; name: string; scopes: string[]; learnerId: string };
}

/**
 * For routes that machine principals may use. Accepts a signed-in human (full access to their own data), or a
 * machine token holding `scope`. A machine token without the scope is refused (and the refusal is audited).
 */
export async function requireAccess(request: NextRequest, scope: MachineScope): Promise<AccessContext> {
  const bearer = bearerToken(request);
  if (!isMachineToken(bearer)) {
    return { user: await requireAuth(request) };
  }

  const tokenHash = hashMachineToken(bearer);
  const principal = await prisma.machinePrincipal.findUnique({
    where: { tokenHash },
    include: { user: { select: USER_SELECT } },
  });

  const now = new Date();
  if (
    !principal ||
    !safeEqualHex(principal.tokenHash, tokenHash) ||
    principal.revokedAt !== null ||
    (principal.expiresAt !== null && principal.expiresAt <= now)
  ) {
    throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  }

  const allowed = hasScope(principal.scopes, scope);
  const path = new URL(request.url).pathname;
  await prisma.machineAudit
    .create({ data: { principalId: principal.id, method: request.method, path, scope, status: allowed ? 200 : 403 } })
    .catch(() => undefined);
  if (!allowed) {
    throw new AppError('Insufficient scope', 403, 'INSUFFICIENT_SCOPE');
  }
  await prisma.machinePrincipal
    .update({ where: { id: principal.id }, data: { lastUsedAt: now } })
    .catch(() => undefined);

  return {
    // Never admin, whatever the learner's own role is.
    user: { ...principal.user, role: 'USER' },
    principal: { id: principal.id, name: principal.name, scopes: principal.scopes, learnerId: principal.learnerId },
  };
}
