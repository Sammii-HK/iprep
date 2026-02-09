"use client";

import { useEffect, useState } from "react";

export function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== "undefined" ? !navigator.onLine : false);
  const [queuedCount, setQueuedCount] = useState(0);

  useEffect(() => {

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Listen for service worker messages about queued requests
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "QUEUED_OFFLINE") {
        setQueuedCount((prev) => prev + 1);
      }
      if (event.data?.type === "QUEUE_REPLAYED") {
        setQueuedCount((prev) => Math.max(0, prev - (event.data.count || 0)));
      }
    };

    navigator.serviceWorker?.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      navigator.serviceWorker?.removeEventListener("message", handleMessage);
    };
  }, []);

  if (!isOffline && queuedCount === 0) return null;

  return (
    <div
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium ${
        isOffline
          ? "bg-red-100 dark:bg-red-900/80 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800"
          : "bg-yellow-100 dark:bg-yellow-900/80 text-yellow-800 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-800"
      }`}
    >
      {isOffline ? (
        <span>You are offline. Some features may be unavailable.</span>
      ) : (
        <span>
          {queuedCount} queued submission{queuedCount !== 1 ? "s" : ""} syncing...
        </span>
      )}
    </div>
  );
}
