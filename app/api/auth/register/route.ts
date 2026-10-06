import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { hashPassword, generateToken } from '@/lib/auth';
import { canonicalEmail } from '@/lib/email';
import { handleApiError } from '@/lib/errors';
import { LIMITS, clientIp, enforceRateLimit } from '@/lib/rate-limit';

const RegisterSchema = z.object({
  email: z.string().email('Invalid email address').max(254),
  // bcrypt only uses the first 72 bytes, so longer passwords are rejected rather than silently truncated.
  password: z.string().min(8, 'Password must be at least 8 characters').max(72, 'Password must be at most 72 characters'),
  name: z.string().min(1, 'Name is required').max(100).optional(),
  inviteCode: z.string().max(200).optional(),
});

/**
 * Public registration is closed. It opens only when BOTH REGISTRATION_ENABLED=true and a
 * REGISTRATION_INVITE_CODE are configured, and the caller supplies the invite code. There is no
 * SaaS onboarding here: this exists so a second learner can be added deliberately.
 */
function registrationOpenFor(inviteCode: string | undefined): boolean {
  if (process.env.REGISTRATION_ENABLED !== 'true') return false;
  const expected = process.env.REGISTRATION_INVITE_CODE;
  if (!expected || !inviteCode) return false;
  const a = Buffer.from(inviteCode);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit({ key: `register:ip:${clientIp(request)}`, ...LIMITS.register });

    const body = await request.json();
    const validated = RegisterSchema.parse(body);

    if (!registrationOpenFor(validated.inviteCode)) {
      return NextResponse.json({ error: 'Registration is closed.', code: 'REGISTRATION_CLOSED' }, { status: 403 });
    }

    const email = canonicalEmail(validated.email);

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      // Same response as any other failure to register, so accounts cannot be enumerated.
      return NextResponse.json({ error: 'Unable to register with these details.', code: 'REGISTRATION_FAILED' }, { status: 400 });
    }

    const hashedPassword = await hashPassword(validated.password);

    // The role is explicit and never derived from an email address or an environment variable.
    // Administrators are created only by a migration or an operator script.
    const user = await prisma.user.create({
      data: {
        email,
        name: validated.name ?? null,
        password: hashedPassword,
        role: 'USER',
        isPremium: false,
        emailVerified: false,
        // The learner (owner of learning evidence) is created with the account.
        learner: { create: {} },
      },
      select: { id: true, email: true, name: true, role: true, isPremium: true, createdAt: true },
    });

    const token = generateToken(user.id);
    const response = NextResponse.json({ user, message: 'Registration successful' });
    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: error.issues }, { status: 400 });
    }
    const errorData = handleApiError(error);
    return NextResponse.json(
      { error: errorData.message, code: errorData.code, details: errorData.details },
      { status: errorData.statusCode }
    );
  }
}
