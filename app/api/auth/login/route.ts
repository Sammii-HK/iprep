import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createHash } from 'crypto';
import { verifyPasswordOrDummy, generateToken } from '@/lib/auth';
import { canonicalEmail } from '@/lib/email';
import { LIMITS, clientIp, enforceRateLimit } from '@/lib/rate-limit';
import { z } from 'zod';
import { handleApiError } from '@/lib/errors';

const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit({ key: `login:ip:${clientIp(request)}`, ...LIMITS.loginIp });

    const body = await request.json();
    const validated = LoginSchema.parse(body);
    const email = canonicalEmail(validated.email);

    // Per-account limit as well as per-IP, so a distributed guess against one account is also slowed.
    const accountKey = createHash('sha256').update(email).digest('hex').slice(0, 32);
    await enforceRateLimit({ key: `login:acct:${accountKey}`, ...LIMITS.loginAccount });

    const user = await prisma.user.findUnique({ where: { email } });

    // Always run a bcrypt comparison (against a dummy hash when the account does not exist) so an unknown
    // email and a wrong password are indistinguishable by response and by timing.
    const isValid = await verifyPasswordOrDummy(validated.password, user?.password);
    if (!user || !isValid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Generate token
    const token = generateToken(user.id);

    // Return user data (without password)
    const userData = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isPremium: user.isPremium,
      createdAt: user.createdAt,
    };

    const response = NextResponse.json({
      user: userData,
      message: 'Login successful',
    });

    // Set cookie
    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
    );
  }
}

