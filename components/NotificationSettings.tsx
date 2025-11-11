'use client';

import { useEffect, useState } from 'react';
import { subscribeToPushNotifications, getPushSubscription, unsubscribeFromPushNotifications } from '@/lib/push-notifications';

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
								: 'bg-purple-200 dark:bg-purple-800 hover:bg-purple-300 dark:hover:bg-purple-700 text-white'
						} disabled:opacity-50 disabled:cursor-not-allowed`}
					>
						{isLoading
							? 'Loading...'
							: isSubscribed
							? 'Disable'
							: 'Enable'}
					</button>
				</div>
			</div>
		</div>
	);
}
