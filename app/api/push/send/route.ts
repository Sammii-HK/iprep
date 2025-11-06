import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import webpush from "web-push";
import { z } from "zod";
import { handleApiError, ValidationError } from "@/lib/errors";

const SendNotificationSchema = z.object({
	subscription: z.object({
		endpoint: z.string().url(),
		keys: z.object({
			p256dh: z.string(),
			auth: z.string(),
		}),
	}),
	payload: z.object({
		title: z.string(),
		body: z.string(),
		tag: z.string().optional(),
		url: z.string().optional(),
	}),
});

export async function POST(request: NextRequest) {
	try {
		await requireAuth(request); // Ensure user is authenticated
		const body = await request.json();
		const validated = SendNotificationSchema.parse(body);

		const config = getConfig();

		if (!config.vapid.publicKey || !config.vapid.privateKey) {
			throw new ValidationError("VAPID keys not configured");
		}

		webpush.setVapidDetails(
			config.vapid.subject,
			config.vapid.publicKey,
			config.vapid.privateKey
		);

		await webpush.sendNotification(
			validated.subscription,
			JSON.stringify({
				title: validated.payload.title,
				body: validated.payload.body,
				icon: "/icon-192x192.png",
				badge: "/icon-192x192.png",
				tag: validated.payload.tag || "notification",
				data: validated.payload.url || "/",
			})
		);

		return NextResponse.json({ success: true });
	} catch (error) {
		const errorData = handleApiError(error);
		return NextResponse.json(
			{ error: errorData.message, code: errorData.code },
			{ status: errorData.statusCode }
		);
	}
}
