"use client";

import { useEffect } from "react";

/**
 * Registers the service worker at /sw.js once on mount.
 * Mount this once in the root layout (inside the providers tree).
 * Task 13 will extend the SW itself for offline caching — this component
 * does not need to change; it just registers whatever sw.js exports.
 */
export function RegisterSW() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[RegisterSW] SW registration failed:", err);
    });
  }, []);

  return null;
}
