import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleApiError } from '@/lib/errors';

/**
 * Analyze user's practice patterns and schedule smart notifications
 * This endpoint is called client-side, avoiding cron limits
 */
export async function POST(request: NextRequest) {
	try {
		const user = await requireAuth(request);

		// Get user's recent sessions
		const recentSessions = await prisma.session.findMany({
			where: {
				userId: user.id,
				isCompleted: true,
			},
			orderBy: {
				completedAt: 'desc',
			},
			take: 10,
			include: {
				summary: true,
			},
		});

		// Calculate days since last practice
		const lastSession = recentSessions[0];
		const daysSinceLastPractice = lastSession?.completedAt
			? Math.floor((Date.now() - new Date(lastSession.completedAt).getTime()) / (1000 * 60 * 60 * 24))
			: 999; // Never practiced

		// Get weak topics from recent sessions
		const weakTags = new Set<string>();
		recentSessions.forEach(session => {
			if (session.summary) {
				const summary = session.summary as { weakTags?: string[] };
				if (summary.weakTags && Array.isArray(summary.weakTags)) {
					summary.weakTags.forEach(tag => weakTags.add(tag));
				}
			}
		});

		// Return recommendations for client-side scheduling
		return NextResponse.json({
			daysSinceLastPractice,
			weakTags: Array.from(weakTags),
			shouldScheduleStudyReminder: daysSinceLastPractice >= 2,
			shouldScheduleWeakTopicsReminder: weakTags.size > 0 && daysSinceLastPractice >= 1,
		});
	} catch (error) {
		const errorData = handleApiError(error);
		return NextResponse.json(
			{ error: errorData.message, code: errorData.code },
			{ status: errorData.statusCode }
		);
	}
}

