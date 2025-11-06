/**
 * Client-side notification scheduler
 * Uses service worker and IndexedDB to schedule notifications without server cron jobs
 */

interface ScheduledNotification {
	id: string;
	type: 'study-reminder' | 'weak-topics';
	scheduledFor: number; // timestamp
	title: string;
	body: string;
	url: string;
}

const DB_NAME = 'iprep-notifications';
const DB_VERSION = 1;
const STORE_NAME = 'scheduled';

/**
 * Initialize IndexedDB for storing scheduled notifications
 */
async function initDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'id' });
			}
		};
	});
}

/**
 * Schedule a notification
 */
export async function scheduleNotification(notification: ScheduledNotification): Promise<void> {
	const db = await initDB();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction([STORE_NAME], 'readwrite');
		const store = transaction.objectStore(STORE_NAME);
		const request = store.put(notification);

		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}

/**
 * Get all scheduled notifications
 */
export async function getScheduledNotifications(): Promise<ScheduledNotification[]> {
	const db = await initDB();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction([STORE_NAME], 'readonly');
		const store = transaction.objectStore(STORE_NAME);
		const request = store.getAll();

		request.onsuccess = () => resolve(request.result || []);
		request.onerror = () => reject(request.error);
	});
}

/**
 * Remove a scheduled notification
 */
export async function removeScheduledNotification(id: string): Promise<void> {
	const db = await initDB();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction([STORE_NAME], 'readwrite');
		const store = transaction.objectStore(STORE_NAME);
		const request = store.delete(id);

		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}

/**
 * Check and trigger notifications that are due
 * This runs in the service worker or periodically in the app
 */
export async function checkAndTriggerNotifications(): Promise<void> {
	if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
		return;
	}

	const notifications = await getScheduledNotifications();
	const now = Date.now();

	for (const notification of notifications) {
		if (notification.scheduledFor <= now) {
			// Trigger notification
			if ('Notification' in window && Notification.permission === 'granted') {
				const registration = await navigator.serviceWorker.ready;
				await registration.showNotification(notification.title, {
					body: notification.body,
					icon: '/icon-192x192.png',
					badge: '/icon-192x192.png',
					tag: notification.id,
					data: notification.url,
					requireInteraction: false,
				});

				// Remove from schedule
				await removeScheduledNotification(notification.id);
			}
		}
	}
}

/**
 * Schedule a study reminder (e.g., "Haven't practiced in 2 days")
 */
export async function scheduleStudyReminder(daysSinceLastPractice: number): Promise<void> {
	// Don't spam - only schedule if it's been a while
	if (daysSinceLastPractice < 1) {
		return;
	}

	// Schedule for tomorrow at 9 AM
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	tomorrow.setHours(9, 0, 0, 0);

	const notification: ScheduledNotification = {
		id: `study-reminder-${Date.now()}`,
		type: 'study-reminder',
		scheduledFor: tomorrow.getTime(),
		title: 'Time to Practice!',
		body: `You haven't practiced in ${daysSinceLastPractice} day${daysSinceLastPractice !== 1 ? 's' : ''}. Keep your skills sharp!`,
		url: '/practice',
	};

	await scheduleNotification(notification);
}

/**
 * Schedule a weak topics reminder
 */
export async function scheduleWeakTopicsReminder(weakTags: string[]): Promise<void> {
	if (weakTags.length === 0) {
		return;
	}

	// Schedule for 2 days from now at 10 AM
	const future = new Date();
	future.setDate(future.getDate() + 2);
	future.setHours(10, 0, 0, 0);

	const notification: ScheduledNotification = {
		id: `weak-topics-${Date.now()}`,
		type: 'weak-topics',
		scheduledFor: future.getTime(),
		title: 'Review Weak Topics',
		body: `Focus on: ${weakTags.slice(0, 3).join(', ')}${weakTags.length > 3 ? '...' : ''}`,
		url: '/practice',
	};

	await scheduleNotification(notification);
}

