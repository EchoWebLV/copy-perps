"use client";

// Honest "live oracle" indicator for the Scalp graph: shows only while marks
// are actually arriving from the MagicBlock ER Lazer feed (the oracle tier
// Flash executes against). When the ER ws path is quiet the badge disappears —
// the Hermes SSE fallback keeps prices flowing but earns no oracle claim.

import { useEffect, useState } from "react";
import { useFlashOracleDeliveryMs } from "@/lib/flash/live-prices-context";

/** Fresh = a delivery within this window (~200 Lazer pushes). */
export const ORACLE_FRESH_MS = 10_000;

export function isOracleFresh(lastDeliveryMs: number, nowMs: number): boolean {
  return lastDeliveryMs > 0 && nowMs - lastDeliveryMs <= ORACLE_FRESH_MS;
}

export function OracleLiveBadge() {
  const lastDeliveryMs = useFlashOracleDeliveryMs();
  // Self-contained 5s re-check so staleness flips the badge off without
  // forcing parent re-renders (the graph samples at its own cadence).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  if (!isOracleFresh(lastDeliveryMs, nowMs)) return null;
  return (
    <span
      className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full border border-white/10 bg-black/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/70"
      title="Mark streamed from the MagicBlock Ephemeral Rollup Pyth Lazer feed — the oracle Flash executes against"
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#1de78b]" />
      live oracle
    </span>
  );
}
