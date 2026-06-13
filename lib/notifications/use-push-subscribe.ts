"use client";

// lib/notifications/use-push-subscribe.ts
//
// Hook that exposes `enablePush()` to subscribe the current browser to web
// push notifications. Requires the user to be authenticated (pass getAccessToken).
//
// Usage:
//   const { toggleState, enablePush } = usePushSubscribe(getAccessToken);
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

// ── deriveToggleState ─────────────────────────────────────────────────────────
//
// Pure function mapping the observable state surface to a toggle label.
// Extracted so it can be unit-tested without a DOM.
//
// States:
//   "on"          — permission granted AND an active push subscription exists
//   "enable"      — not yet subscribed (default, or granted-but-not-subscribed)
//   "blocked"     — permission explicitly denied by user
//   "unsupported" — browser/device doesn't support push
//   "error"       — transient error (e.g. SW timeout, subscribe failed)
//   "enabling"    — subscribe in progress

export type ToggleState =
  | "on"
  | "enable"
  | "blocked"
  | "unsupported"
  | "error"
  | "enabling";

export interface ToggleStateInput {
  supported: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
  subscribing: boolean;
  error: string | null;
}

export function deriveToggleState({
  supported,
  permission,
  subscribed,
  subscribing,
  error,
}: ToggleStateInput): ToggleState {
  if (!supported) return "unsupported";
  if (permission === "denied") return "blocked";
  if (subscribing) return "enabling";
  if (error) return "error";
  if (permission === "granted" && subscribed) return "on";
  // covers: permission === "default" OR permission === "granted" but no subscription
  return "enable";
}

// ── Types ──────────────────────────────────────────────────────────────────────

type NotificationPermission = "default" | "granted" | "denied";

const SW_REGISTER_TIMEOUT_MS = 8_000;

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePushSubscribe(
  getAccessToken: () => Promise<string | null>,
) {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  // True only when we've confirmed an active PushSubscription exists in the browser.
  const [subscribed, setSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync initial permission state and check for an existing subscription.
  useEffect(() => {
    if (!isPushSupported()) return;

    const perm = Notification.permission as NotificationPermission;
    setPermission(perm);

    // If permission is granted, check whether a real subscription already exists.
    if (perm === "granted") {
      void (async () => {
        try {
          const reg = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("SW ready timeout")), SW_REGISTER_TIMEOUT_MS),
            ),
          ]);
          const existing = await reg.pushManager.getSubscription();
          if (existing) setSubscribed(true);
        } catch {
          // SW not ready on mount — subscribed stays false, no error surfaced
        }
      })();
    }
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

      // 2. Register (or re-use) the service worker — idempotent.
      //    Race against a timeout so a stuck registration surfaces an error.
      const reg = await Promise.race([
        navigator.serviceWorker.register("/sw.js"),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Couldn't start notifications — try reloading.")),
            SW_REGISTER_TIMEOUT_MS,
          ),
        ),
      ]);

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

      // Only flip subscribed after the POST succeeds — permission-granted ≠ subscription-persisted.
      setSubscribed(true);
    } catch (err) {
      console.error("[usePushSubscribe] enablePush failed:", err);
      setError(err instanceof Error ? err.message : String(err));
      // Ensure subscribed stays false on any failure path.
      setSubscribed(false);
    } finally {
      setSubscribing(false);
    }
  }, [getAccessToken]);

  const toggleState = deriveToggleState({
    supported: isPushSupported(),
    permission,
    subscribed,
    subscribing,
    error,
  });

  return {
    permission,
    subscribed,
    subscribing,
    error,
    enablePush,
    supported: isPushSupported(),
    toggleState,
  };
}
