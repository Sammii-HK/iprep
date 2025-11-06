import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';
import { prisma } from './db';
import { getConfig } from './config';
import { AppError } from './errors';

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

export function generateToken(userId: string): string {
  return jwt.sign({ userId }, getJWTSecret(), { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, getJWTSecret()) as { userId: string };
    return decoded.userId;
  } catch {
    return null;
  }
}

export async function getCurrentUser(request: NextRequest): Promise<{
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  isPremium: boolean;
  emailVerified: boolean;
  createdAt: Date;
} | null> {
  try {
    // Try to get token from cookie first
    const token = request.cookies.get('auth-token')?.value || 
                 request.headers.get('authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return null;
    }

    const userId = verifyToken(token);
    if (!userId) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isPremium: true,
        emailVerified: true,
        createdAt: true,
      },
    });

    return user;
  } catch {
    return null;
  }
}

export async function requireAuth(request: NextRequest): Promise<{
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  isPremium: boolean;
  emailVerified: boolean;
  createdAt: Date;
}> {
  const user = await getCurrentUser(request);
  if (!user) {
    throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  }
  return user;
}

export async function requireAdmin(request: NextRequest): Promise<{
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  isPremium: boolean;
  emailVerified: boolean;
  createdAt: Date;
}> {
  const user = await requireAuth(request);
  if (!isAdmin(user.email || '')) {
    throw new AppError('Admin access required', 403, 'ADMIN_ACCESS_REQUIRED');
  }
  return user;
}

export function isAdmin(email: string): boolean {
  if (!email) return false;
  const config = getConfig();
  const adminEmail = config.admin.email;
  return email.toLowerCase() === adminEmail.toLowerCase();
}

