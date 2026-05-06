"use client";

import { useEffect, useRef, useState } from "react";

// Tracks a value across renders. When it changes, returns a "pulse"
// flag that's true for ~600ms then false again — wire it into
// className to flash a brief highlight on the displayed value.
//
// First render NEVER pulses (avoids a flash on initial mount); only
// transitions from a previously-seen value to a new one trigger.
//
// `key` is whatever you want to compare. For numbers pass the number;
// for compound state (e.g. price + side) pass a serialized string.
export function usePulseOnChange<T>(
  key: T,
  durationMs = 600,
): "up" | "down" | null {
  const prev = useRef<T | undefined>(undefined);
  const [pulse, setPulse] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (prev.current === undefined) {
      prev.current = key;
      return;
    }
    if (Object.is(prev.current, key)) return;

    const direction =
      typeof key === "number" && typeof prev.current === "number"
        ? key > prev.current
          ? "up"
          : key < prev.current
            ? "down"
            : null
        : "up";

    prev.current = key;
    if (direction) {
      setPulse(direction);
      const timer = setTimeout(() => setPulse(null), durationMs);
      return () => clearTimeout(timer);
    }
  }, [key, durationMs]);

  return pulse;
}
