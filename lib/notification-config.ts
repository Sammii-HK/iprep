/**
 * Notification preferences configuration
 */

export type NotificationFrequency = 'daily' | 'weekly' | 'never';
export type NotificationType = 'study-reminder' | 'weak-topics';
export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface NotificationPreferences {
	enabled: boolean;
	frequency: NotificationFrequency;
	types: NotificationType[];
	time: string; // HH:mm format (e.g., "09:00")
	daysOfWeek: DayOfWeek[]; // Only used for weekly frequency
	minDaysSinceLastPractice: number; // Minimum days before sending study reminder
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
	enabled: true,
	frequency: 'daily',
	types: ['study-reminder', 'weak-topics'],
	time: '09:00',
	daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
	minDaysSinceLastPractice: 2,
};

export function getNotificationPreferences(): NotificationPreferences {
	if (typeof window === 'undefined') {
		return DEFAULT_NOTIFICATION_PREFERENCES;
	}

	const saved = localStorage.getItem('notificationPreferences');
	if (saved) {
		try {
			return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...JSON.parse(saved) };
		} catch {
			// Use defaults if parse fails
		}
	}
	return DEFAULT_NOTIFICATION_PREFERENCES;
}

export function saveNotificationPreferences(preferences: NotificationPreferences): void {
	if (typeof window !== 'undefined') {
		localStorage.setItem('notificationPreferences', JSON.stringify(preferences));
	}
}

