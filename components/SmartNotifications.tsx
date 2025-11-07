'use client';

import { useEffect, useState, useCallback } from 'react';
import { scheduleStudyReminder, scheduleWeakTopicsReminder, checkAndTriggerNotifications } from '@/lib/notification-scheduler';

/**
 * Component that schedules smart notifications based on user activity
 * Runs client-side to avoid cron limits
 */
export function SmartNotifications() {
	// Initialize state directly instead of in useEffect
	const [isEnabled, setIsEnabled] = useState(() => {
		if (typeof window !== 'undefined' && 'Notification' in window) {
			return Notification.permission === 'granted';
		}
		return false;
	});

	// Request notification permission if not granted
	useEffect(() => {
		if (typeof window !== 'undefined' && 'Notification' in window) {
			if (Notification.permission === 'default') {
				// Request permission
				Notification.requestPermission().then((permission) => {
					setIsEnabled(permission === 'granted');
				});
			}
		}
	}, []);

	const scheduleNotifications = useCallback(async () => {
		if (!isEnabled) return;

		try {
			// Get user's practice patterns
			const response = await fetch('/api/notifications/schedule', {
				method: 'POST',
			});

			if (response.ok) {
				const data = await response.json();

				// Schedule study reminder if needed (haven't practiced in 2+ days)
				if (data.shouldScheduleStudyReminder && data.daysSinceLastPractice >= 2) {
					await scheduleStudyReminder(data.daysSinceLastPractice);
				}

				// Schedule weak topics reminder if needed
				if (data.shouldScheduleWeakTopicsReminder && data.weakTags.length > 0) {
					// Only schedule if it's been at least 1 day since last practice
					// This prevents spamming
					if (data.daysSinceLastPractice >= 1) {
						await scheduleWeakTopicsReminder(data.weakTags);
					}
				}
			}
		} catch (error) {
			console.error('Error scheduling notifications:', error);
		}
	}, [isEnabled]);

	useEffect(() => {
		if (!isEnabled) return;

		// Schedule notifications when component mounts
		scheduleNotifications();

		// Check for due notifications every 30 minutes
		const interval = setInterval(() => {
			checkAndTriggerNotifications();
		}, 30 * 60 * 1000); // 30 minutes

		// Also check immediately
		checkAndTriggerNotifications();

		return () => clearInterval(interval);
	}, [scheduleNotifications, isEnabled]);

	// This component doesn't render anything - it just runs in the background
	return null;
}

