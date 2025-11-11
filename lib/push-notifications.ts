/**
 * Client-side utilities for push notifications
 */

export async function requestNotificationPermission(): Promise<NotificationPermission> {
	if (!('Notification' in window)) {
		throw new Error('This browser does not support notifications');
	}

	if (Notification.permission === 'granted') {
		return 'granted';
	}

	if (Notification.permission === 'denied') {
		throw new Error('Notification permission was previously denied');
	}

	return await Notification.requestPermission();
}

export async function subscribeToPushNotifications(): Promise<PushSubscription | null> {
	if (!('serviceWorker' in navigator)) {
		throw new Error('Service workers are not supported');
	}

	if (!('PushManager' in window)) {
		throw new Error('Push messaging is not supported');
	}

	// Request notification permission first
	const permission = await requestNotificationPermission();
	if (permission !== 'granted') {
		throw new Error('Notification permission denied');
	}

	// Get service worker registration
	const registration = await navigator.serviceWorker.ready;

	// Get VAPID public key from server
	const response = await fetch('/api/push/subscribe');
	if (!response.ok) {
		throw new Error('Failed to get VAPID public key');
	}

	const { publicKey } = await response.json();

	// Convert VAPID key to Uint8Array
	const applicationServerKey = urlBase64ToUint8Array(publicKey);

	// Subscribe to push notifications
	// PushManager.subscribe accepts BufferSource which includes Uint8Array
	const subscription = await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: applicationServerKey as BufferSource,
	});

	// Send subscription to server
	const subscribeResponse = await fetch('/api/push/subscribe', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(subscription.toJSON()),
	});

	if (!subscribeResponse.ok) {
		const errorData = await subscribeResponse.json().catch(() => ({ error: 'Unknown error' }));
		const errorMessage = errorData.error || errorData.message || 'Failed to subscribe to push notifications';
		console.error('Push subscription error:', errorData);
		throw new Error(errorMessage);
	}

	return subscription;
}

export async function unsubscribeFromPushNotifications(): Promise<boolean> {
	if (!('serviceWorker' in navigator)) {
		return false;
	}

	const registration = await navigator.serviceWorker.ready;
	const subscription = await registration.pushManager.getSubscription();

	if (subscription) {
		await subscription.unsubscribe();
		return true;
	}

	return false;
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
	if (!('serviceWorker' in navigator)) {
		return null;
	}

	const registration = await navigator.serviceWorker.ready;
	return await registration.pushManager.getSubscription();
}

/**
 * Convert a base64 URL-safe string to a Uint8Array
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

	const rawData = window.atob(base64);
	const outputArray = new Uint8Array(rawData.length);

	for (let i = 0; i < rawData.length; ++i) {
		outputArray[i] = rawData.charCodeAt(i);
	}

	return outputArray;
}

