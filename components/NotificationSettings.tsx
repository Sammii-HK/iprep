'use client';

import { useEffect, useState } from 'react';
import { subscribeToPushNotifications, getPushSubscription, unsubscribeFromPushNotifications } from '@/lib/push-notifications';
import { checkAndTriggerNotifications } from '@/lib/notification-scheduler';

export function NotificationSettings() {
	const [isSupported, setIsSupported] = useState(false);
	const [isSubscribed, setIsSubscribed] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [permission, setPermission] = useState<NotificationPermission>('default');

	useEffect(() => {
		// Check if notifications are supported
		if (typeof window !== 'undefined') {
			setIsSupported('Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window);
			
			if ('Notification' in window) {
				setPermission(Notification.permission);
			}

			// Check if already subscribed
			checkSubscription();
		}
	}, []);

	const checkSubscription = async () => {
		try {
			const subscription = await getPushSubscription();
			setIsSubscribed(!!subscription);
		} catch (error) {
			console.error('Error checking subscription:', error);
		}
	};

	const handleSubscribe = async () => {
		setIsLoading(true);
		try {
			await subscribeToPushNotifications();
			setIsSubscribed(true);
			setPermission('granted');
			alert('Notifications enabled! You will receive study reminders.');
		} catch (error) {
			console.error('Error subscribing:', error);
			alert(error instanceof Error ? error.message : 'Failed to enable notifications');
		} finally {
			setIsLoading(false);
		}
	};

	const handleUnsubscribe = async () => {
		setIsLoading(true);
		try {
			await unsubscribeFromPushNotifications();
			setIsSubscribed(false);
			alert('Notifications disabled');
		} catch (error) {
			console.error('Error unsubscribing:', error);
			alert('Failed to disable notifications');
		} finally {
			setIsLoading(false);
		}
	};

	const handleTestNotification = async () => {
		if (!('Notification' in window)) {
			alert('Notifications are not supported in this browser');
			return;
		}

		if (Notification.permission !== 'granted') {
			const permission = await Notification.requestPermission();
			if (permission !== 'granted') {
				alert('Notification permission denied');
				return;
			}
			setPermission(permission);
		}

		try {
			// Get service worker registration
			const registration = await navigator.serviceWorker.ready;
			
			// Show a test notification
			await registration.showNotification('Test Notification', {
				body: 'Notifications are working! You will receive study reminders.',
				icon: '/icon-192x192.png',
				badge: '/icon-192x192.png',
				tag: 'test-notification',
				data: '/practice',
				requireInteraction: false,
			});

			alert('Test notification sent! Check your notifications.');
		} catch (error) {
			console.error('Error showing test notification:', error);
			alert('Failed to show test notification. Make sure the app is installed and service worker is active.');
		}
	};

	if (!isSupported) {
		return (
			<div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
				<p className="text-sm text-yellow-800 dark:text-yellow-200">
					Push notifications are not supported in this browser.
				</p>
			</div>
		);
	}

	if (permission === 'denied') {
		return (
			<div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
				<p className="text-sm text-red-800 dark:text-red-200">
					Notification permission was denied. Please enable it in your browser settings.
				</p>
			</div>
		);
	}

	return (
		<div className="p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
			<div className="space-y-4">
				<div className="flex items-center justify-between">
					<div>
						<h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
							Push Notifications
						</h3>
						<p className="text-sm text-slate-600 dark:text-slate-400">
							{isSubscribed
								? 'You will receive study reminders'
								: 'Enable to receive study reminders'}
						</p>
					</div>
					<button
						onClick={isSubscribed ? handleUnsubscribe : handleSubscribe}
						disabled={isLoading}
						className={`px-4 py-2 rounded-lg font-medium transition-colors ${
							isSubscribed
								? 'bg-red-500 hover:bg-red-600 text-white'
								: 'bg-blue-500 hover:bg-blue-600 text-white'
						} disabled:opacity-50 disabled:cursor-not-allowed`}
					>
						{isLoading
							? 'Loading...'
							: isSubscribed
							? 'Disable'
							: 'Enable'}
					</button>
				</div>
				
				{permission === 'granted' && (
					<div className="pt-2 border-t border-slate-200 dark:border-slate-700">
						<button
							onClick={handleTestNotification}
							className="w-full px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors"
						>
							🔔 Test Notification
						</button>
						<p className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-center">
							Click to verify notifications are working
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
