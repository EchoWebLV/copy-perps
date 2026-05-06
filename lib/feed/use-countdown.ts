"use client";

import { useEffect, useState } from "react";

// Returns a human-readable time-until string for a unix-seconds target,
// updating every second. Returns null when target is missing/past.
//
// Format ladder:
//   > 7d:  "12d"
//   > 1d:  "3d 4h"
//   > 1h:  "5h 23m"
//   > 1m:  "12m 04s"
//   < 1m:  "47s"
//   <= 0:  "Resolved"
export function useCountdown(targetUnixSec: number | undefined): string | null {
  const [, force] = useState(0);

  useEffect(() => {
    if (!targetUnixSec) return;
    const timer = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [targetUnixSec]);

  if (!targetUnixSec) return null;
  const nowSec = Date.now() / 1000;
  const remaining = targetUnixSec - nowSec;
  if (remaining <= 0) return "Resolved";

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = Math.floor(remaining % 60);

  if (days >= 7) return `${days}d`;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}
