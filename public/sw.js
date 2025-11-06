// Service Worker for Interview Coach PWA
const CACHE_NAME = 'interview-coach-v1';
const urlsToCache = [
  '/',
  '/banks',
  '/practice',
  '/analytics',
  '/quizzes',
];

// Install event - cache assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

// Periodic background sync - check for scheduled notifications
// This runs periodically even when the app is closed
self.addEventListener('sync', (event) => {
  if (event.tag === 'check-notifications') {
    event.waitUntil(checkScheduledNotifications());
  }
});

// Check scheduled notifications from IndexedDB
async function checkScheduledNotifications() {
  try {
    // Open IndexedDB
    const openDB = () => {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('iprep-notifications', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('scheduled')) {
            db.createObjectStore('scheduled', { keyPath: 'id' });
          }
        };
      });
    };

    const db = await openDB();
    const transaction = db.transaction(['scheduled'], 'readonly');
    const store = transaction.objectStore('scheduled');
    const getAllNotifications = () => {
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    };

    const notifications = await getAllNotifications();
    const now = Date.now();
    
    for (const notification of notifications) {
      if (notification.scheduledFor <= now) {
        // Show notification
        await self.registration.showNotification(notification.title, {
          body: notification.body,
          icon: '/icon-192x192.png',
          badge: '/icon-192x192.png',
          tag: notification.id,
          data: notification.url,
        });

        // Remove from IndexedDB
        const deleteTransaction = db.transaction(['scheduled'], 'readwrite');
        const deleteStore = deleteTransaction.objectStore('scheduled');
        deleteStore.delete(notification.id);
      }
    }
  } catch (error) {
    console.error('Error checking scheduled notifications:', error);
  }
}

// Check notifications periodically when service worker is active
// Note: This only works when the service worker is active (app is open)
// For true background notifications, use Background Sync API or scheduled notifications
if (typeof self !== 'undefined' && self.registration) {
  // Register periodic background sync if available
  if ('serviceWorker' in navigator && 'sync' in self.registration) {
    // This will be called by the browser periodically
  }
}

// Push notification event
self.addEventListener('push', (event) => {
  let notificationData = {
    title: 'Interview Coach',
    body: 'Time to practice!',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    tag: 'study-reminder',
    data: '/practice',
  };

  if (event.data) {
    try {
      const data = event.data.json();
      notificationData = {
        title: data.title || notificationData.title,
        body: data.body || notificationData.body,
        icon: data.icon || notificationData.icon,
        badge: data.badge || notificationData.badge,
        tag: data.tag || notificationData.tag,
        data: data.url || data.data || notificationData.data,
      };
    } catch (e) {
      console.error('Error parsing push notification data:', e);
    }
  }

  const options = {
    body: notificationData.body,
    icon: notificationData.icon,
    badge: notificationData.badge,
    tag: notificationData.tag,
    data: notificationData.data,
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
  };

  event.waitUntil(self.registration.showNotification(notificationData.title, options));
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'practice') {
    event.waitUntil(
      clients.openWindow('/practice')
    );
  } else if (event.action === 'dismiss') {
    // Just close the notification
    return;
  } else {
    // Default action - open the app
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        if (clientList.length > 0) {
          return clientList[0].focus();
        }
        return clients.openWindow(event.notification.data || '/');
      })
    );
  }
});

