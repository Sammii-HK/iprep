import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword, generateToken, isAdmin } from '@/lib/auth';
import { z } from 'zod';
import { handleApiError } from '@/lib/errors';

const RegisterSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = RegisterSchema.parse(body);

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: validated.email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await hashPassword(validated.password);

    // Determine role - admin if email matches ADMIN_EMAIL
    const role = isAdmin(validated.email) ? 'ADMIN' : 'USER';
    // Admin users get premium access automatically
    const isPremium = isAdmin(validated.email);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: validated.email,
        name: validated.name || null,
        password: hashedPassword,
        role,
        isPremium,
        emailVerified: false, // Can add email verification later
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isPremium: true,
        createdAt: true,
      },
    });

    // Generate token
    const token = generateToken(user.id);

    // Set cookie
    const response = NextResponse.json({
      user,
      message: 'Registration successful',
    });

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
    return handleApiError(error);
  }
}

