"use client";

// lib/notifications/use-push-subscribe.ts
//
// Hook that exposes `enablePush()` to subscribe the current browser to web
// push notifications. Requires the user to be authenticated (pass getAccessToken).
//
// Usage:
//   const { permission, enablePush } = usePushSubscribe(getAccessToken);
//   <button onClick={enablePush}>Enable push alerts</button>

import { useCallback, useEffect, useState } from "react";

// ── URL-safe base64 → Uint8Array (standard VAPID helper) ──────────────────────
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ── Push support detection ─────────────────────────────────────────────────────

function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

type NotificationPermission = "default" | "granted" | "denied";

export function usePushSubscribe(
  getAccessToken: () => Promise<string | null>,
) {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync initial permission state
  useEffect(() => {
    if (!isPushSupported()) return;
    setPermission(Notification.permission as NotificationPermission);
  }, []);

  const enablePush = useCallback(async () => {
    if (!isPushSupported()) {
      setError("Push notifications are not supported on this device/browser.");
      return;
    }

    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
      setError("Push is not configured (missing VAPID key).");
      return;
    }

    setSubscribing(true);
    setError(null);

    try {
      // 1. Request permission
      const perm = await Notification.requestPermission();
      setPermission(perm as NotificationPermission);
      if (perm !== "granted") {
        setError("Push permission denied by the browser.");
        return;
      }

      // 2. Get the service worker registration (must already be registered)
      const reg = await navigator.serviceWorker.ready;

      // 3. Subscribe via push manager
      const keyBytes = urlBase64ToUint8Array(vapidKey);
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes.buffer as ArrayBuffer,
      });

      // 4. Send the subscription to our backend
      const token = await getAccessToken();
      if (!token) {
        setError("Not authenticated. Please log in first.");
        return;
      }

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(subscription.toJSON()),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      console.error("[usePushSubscribe] enablePush failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubscribing(false);
    }
  }, [getAccessToken]);

  return { permission, subscribing, error, enablePush, supported: isPushSupported() };
}
