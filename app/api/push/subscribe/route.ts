import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import webpush from 'web-push';
import { z } from 'zod';
import { handleApiError, ValidationError } from '@/lib/errors';

const SubscribeSchema = z.object({
	endpoint: z.string().url(),
	keys: z.object({
		p256dh: z.string(),
		auth: z.string(),
	}),
});

export async function POST(request: NextRequest) {
	try {
		await requireAuth(request); // Ensure user is authenticated
		const body = await request.json();
		const validated = SubscribeSchema.parse(body);

		const config = getConfig();

		// Check if VAPID keys are configured
		if (!config.vapid.publicKey || !config.vapid.privateKey) {
			throw new ValidationError(
				'VAPID keys not configured. Please set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables.'
			);
		}

		// Set VAPID details
		webpush.setVapidDetails(
			config.vapid.subject,
			config.vapid.publicKey,
			config.vapid.privateKey
		);

		const subscription = {
			endpoint: validated.endpoint,
			keys: {
				p256dh: validated.keys.p256dh,
				auth: validated.keys.auth,
			},
		};

		// Store subscription in database (you may want to add a PushSubscription model)
		// For now, we'll store it as JSON in user preferences or create a separate model
		// This is a simplified version - you might want to update the User model to store subscriptions

		// Send a test notification to verify subscription works
		try {
			await webpush.sendNotification(
				subscription,
				JSON.stringify({
					title: 'Notifications Enabled',
					body: 'You will now receive study reminders!',
					icon: '/icon-192x192.png',
					tag: 'subscription-success',
				})
			);
		} catch (error) {
			console.error('Error sending test notification:', error);
			// Don't fail the subscription if test notification fails
		}

		return NextResponse.json({
			success: true,
			message: 'Successfully subscribed to push notifications',
		});
	} catch (error) {
		const errorData = handleApiError(error);
		return NextResponse.json(
			{ error: errorData.message, code: errorData.code, details: errorData.details },
			{ status: errorData.statusCode }
		);
	}
}

// GET endpoint to return public VAPID key
export async function GET() {
	try {
		const config = getConfig();

		if (!config.vapid.publicKey) {
			return NextResponse.json(
				{ error: 'VAPID keys not configured' },
				{ status: 500 }
			);
		}

		return NextResponse.json({
			publicKey: config.vapid.publicKey,
		});
	} catch (error) {
		const errorData = handleApiError(error);
		return NextResponse.json(
			{ error: errorData.message, code: errorData.code },
			{ status: errorData.statusCode }
		);
	}
}

