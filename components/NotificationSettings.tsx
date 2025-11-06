'use client';

import { useState, useEffect } from 'react';

interface NotificationSettingsProps {
  onSettingsChange?: (enabled: boolean, time: string) => void;
}

export function NotificationSettings({ onSettingsChange }: NotificationSettingsProps) {
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [reminderTime, setReminderTime] = useState('09:00');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check notification permission
    if ('Notification' in window) {
      setPermission(Notification.permission);
      
      // Load saved settings
      const savedEnabled = localStorage.getItem('notificationsEnabled') === 'true';
      const savedTime = localStorage.getItem('reminderTime') || '09:00';
      setEnabled(savedEnabled);
      setReminderTime(savedTime);
    }
    setIsLoading(false);
  }, []);

  const requestPermission = async () => {
    if (!('Notification' in window)) {
      alert('This browser does not support notifications');
      return;
    }

    const permission = await Notification.requestPermission();
    setPermission(permission);

    if (permission === 'granted') {
      setEnabled(true);
      localStorage.setItem('notificationsEnabled', 'true');
      onSettingsChange?.(true, reminderTime);
      
      // Register service worker for push notifications
      if ('serviceWorker' in navigator) {
        try {
          const registration = await navigator.serviceWorker.ready;
          console.log('Service Worker ready for notifications');
        } catch (error) {
          console.error('Service Worker registration failed:', error);
        }
      }
    }
  };

  const handleToggle = (newEnabled: boolean) => {
    if (newEnabled && permission !== 'granted') {
      requestPermission();
      return;
    }

    setEnabled(newEnabled);
    localStorage.setItem('notificationsEnabled', newEnabled.toString());
    onSettingsChange?.(newEnabled, reminderTime);
    
    if (newEnabled) {
      scheduleReminder(reminderTime);
    } else {
      cancelReminders();
    }
  };

  const handleTimeChange = (newTime: string) => {
    setReminderTime(newTime);
    localStorage.setItem('reminderTime', newTime);
    onSettingsChange?.(enabled, newTime);
    
    if (enabled) {
      scheduleReminder(newTime);
    }
  };

  const scheduleReminder = (time: string) => {
    if (!('serviceWorker' in navigator)) return;

    const [hours, minutes] = time.split(':').map(Number);
    const now = new Date();
    const scheduledTime = new Date();
    scheduledTime.setHours(hours, minutes, 0, 0);

    // If time has passed today, schedule for tomorrow
    if (scheduledTime < now) {
      scheduledTime.setDate(scheduledTime.getDate() + 1);
    }

    const timeUntilReminder = scheduledTime.getTime() - now.getTime();

    // Schedule daily reminder
    setTimeout(() => {
      showReminderNotification();
      // Schedule next day's reminder
      setInterval(() => {
        showReminderNotification();
      }, 24 * 60 * 60 * 1000); // 24 hours
    }, timeUntilReminder);
  };

  const showReminderNotification = () => {
    if (permission === 'granted' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        registration.showNotification('Time to Practice! 📚', {
          body: 'Keep improving your interview skills. Practice makes perfect!',
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: 'study-reminder',
          requireInteraction: false,
          actions: [
            {
              action: 'practice',
              title: 'Start Practice',
            },
            {
              action: 'dismiss',
              title: 'Dismiss',
            },
          ],
          data: {
            url: '/practice',
          },
        });
      });
    }
  };

  const cancelReminders = () => {
    // Notifications are handled by service worker, so we just update state
    // The service worker will respect the enabled flag
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
        <div className="animate-pulse">Loading notification settings...</div>
      </div>
    );
  }

  if (!('Notification' in window)) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
        <p className="text-slate-600 dark:text-slate-400">
          Notifications are not supported in this browser.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
      <h3 className="text-lg font-semibold mb-4 text-slate-900 dark:text-slate-100">
        Study Reminders
      </h3>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Enable Daily Reminders
            </label>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Get notified to practice your interview skills
            </p>
          </div>
          <button
            onClick={() => handleToggle(!enabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {permission === 'denied' && (
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              Notifications are blocked. Please enable them in your browser settings.
            </p>
          </div>
        )}

        {permission !== 'granted' && permission !== 'denied' && (
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
              Click the toggle to enable notifications. You'll need to allow notifications in your browser.
            </p>
          </div>
        )}

        {enabled && permission === 'granted' && (
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Reminder Time:
            </label>
            <input
              type="time"
              value={reminderTime}
              onChange={(e) => handleTimeChange(e.target.value)}
              className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>
        )}
      </div>
    </div>
  );
}

