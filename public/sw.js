// Service Worker for iPrep PWA
const CACHE_NAME = 'iprep-v2';
const STATIC_CACHE = 'iprep-static-v2';

const STATIC_ASSETS = [
  '/icon-192x192.png',
  '/icon-512x512.png',
];

// Install - pre-cache static assets only
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME && name !== STATIC_CACHE)
          .map((name) => caches.delete(name))
      )
    )
  );
  return self.clients.claim();
});

// Fetch strategy:
// - API calls: network-only (no caching)
// - Navigation (pages): stale-while-revalidate
// - Static assets: cache-first
// - Everything else: network-first with cache fallback
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests (POST, etc.)
  if (event.request.method !== 'GET') {
    return;
  }

  // API routes - always go to network
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Static assets - cache first
  if (STATIC_ASSETS.some((asset) => url.pathname === asset) ||
      url.pathname.match(/\.(js|css|png|jpg|svg|woff2?)$/)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Navigation requests (pages) - stale-while-revalidate
  if (event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Everything else - network first
  event.respondWith(networkFirst(event.request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // Start fetching fresh version in background
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // Return cached version immediately if available, otherwise wait for network
  if (cached) {
    // Still fetch in background to update cache
    fetchPromise;
    return cached;
  }

  const networkResponse = await fetchPromise;
  if (networkResponse) return networkResponse;

  // Offline fallback
  return new Response(
    '<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h1>You are offline</h1><p>Please check your connection and try again.</p></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html' } }
  );
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline', { status: 503 });
  }
}

// Offline queue for failed practice submissions
const QUEUE_DB_NAME = 'iprep-offline-queue';
const QUEUE_STORE = 'pending';

function openQueueDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(QUEUE_DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

async function queueFailedRequest(url, formDataEntries) {
  try {
    const db = await openQueueDB();
    const tx = db.transaction([QUEUE_STORE], 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    store.add({
      url,
      data: formDataEntries,
      timestamp: Date.now(),
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });

    // Notify clients about queued request
    const clients = await self.clients.matchAll();
    clients.forEach((client) => {
      client.postMessage({ type: 'QUEUED_OFFLINE', url });
    });
  } catch (error) {
    console.error('Failed to queue request:', error);
  }
}

async function replayQueue() {
  try {
    const db = await openQueueDB();
    const tx = db.transaction([QUEUE_STORE], 'readonly');
    const store = tx.objectStore(QUEUE_STORE);
    const items = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    if (items.length === 0) return;

    let replayed = 0;
    for (const item of items) {
      try {
        const formData = new FormData();
        for (const [key, value] of Object.entries(item.data)) {
          if (value instanceof ArrayBuffer) {
            formData.append(key, new Blob([value]));
          } else {
            formData.append(key, value);
          }
        }

        const response = await fetch(item.url, {
          method: 'POST',
          body: formData,
        });

        if (response.ok) {
          // Remove from queue
          const deleteTx = db.transaction([QUEUE_STORE], 'readwrite');
          deleteTx.objectStore(QUEUE_STORE).delete(item.id);
          replayed++;
        }
      } catch {
        // Still offline for this item, skip
      }
    }

    if (replayed > 0) {
      const clients = await self.clients.matchAll();
      clients.forEach((client) => {
        client.postMessage({ type: 'QUEUE_REPLAYED', count: replayed });
      });
    }
  } catch (error) {
    console.error('Failed to replay queue:', error);
  }
}

// Background sync - replay queued submissions when back online
self.addEventListener('sync', (event) => {
  if (event.tag === 'replay-queue') {
    event.waitUntil(replayQueue());
  }
  if (event.tag === 'check-notifications') {
    event.waitUntil(checkScheduledNotifications());
  }
});

// Periodic background sync - check for scheduled notifications
async function checkScheduledNotifications() {
  try {
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
    const notifications = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    const now = Date.now();
    for (const notification of notifications) {
      if (notification.scheduledFor <= now) {
        await self.registration.showNotification(notification.title, {
          body: notification.body,
          icon: '/icon-192x192.png',
          badge: '/icon-192x192.png',
          tag: notification.id,
          data: notification.url,
        });

        const deleteTransaction = db.transaction(['scheduled'], 'readwrite');
        deleteTransaction.objectStore('scheduled').delete(notification.id);
      }
    }
  } catch (error) {
    console.error('Error checking scheduled notifications:', error);
  }
}

// Push notification event
self.addEventListener('push', (event) => {
  let notificationData = {
    title: 'iPrep',
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

  event.waitUntil(
    self.registration.showNotification(notificationData.title, {
      body: notificationData.body,
      icon: notificationData.icon,
      badge: notificationData.badge,
      tag: notificationData.tag,
      data: notificationData.data,
      requireInteraction: false,
      actions: [
        { action: 'practice', title: 'Start Practice' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    })
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'practice') {
    event.waitUntil(clients.openWindow('/practice'));
  } else if (event.action === 'dismiss') {
    return;
  } else {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        if (clientList.length > 0) return clientList[0].focus();
        return clients.openWindow(event.notification.data || '/');
      })
    );
  }
});
