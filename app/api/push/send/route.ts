import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { PushSubscriptionSchema } from "@/lib/push-validation";
import { LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { getConfig } from "@/lib/config";
import webpush from "web-push";
import { z } from "zod";
import { handleApiError, ValidationError } from "@/lib/errors";

// The subscription must point at a real browser push service (never an arbitrary URL: that would make this
// server a request relay) and the payload is bounded. The click target must be a path inside this app.
const SendNotificationSchema = z.object({
	subscription: PushSubscriptionSchema,
	payload: z.object({
		title: z.string().min(1).max(100),
		body: z.string().min(1).max(300),
		tag: z.string().max(64).optional(),
		url: z.string().max(200).regex(/^\/[A-Za-z0-9\-._~\/?=&%#]*$/, "Must be a path inside the app").optional(),
	}),
});

export async function POST(request: NextRequest) {
	try {
		// Sending arbitrary notifications under the app's VAPID identity is an admin operation.
		const admin = await requireAdmin(request);
		await enforceRateLimit({ key: `push-send:${admin.id}`, ...LIMITS.push });
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
