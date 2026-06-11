"use client";

// Mini close-series for feed-card sparklines: /api/markets/candles (the same
// endpoint the old LiveEntryChart used), 1m × 60, with a module-level cache so
// twenty whale cards on one asset cost one fetch. Null while loading/unknown —
// cards simply omit the sparkline (never block render on chart data).

import { useEffect, useState } from "react";

const CACHE_TTL_MS = 60_000;

type CacheEntry = { at: number; promise: Promise<number[] | null> };
const cache = new Map<string, CacheEntry>();

async function fetchCloses(asset: string): Promise<number[] | null> {
  try {
    const res = await fetch(
      `/api/markets/candles?asset=${encodeURIComponent(asset)}&timeframe=1m&count=60`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      candles?: Array<{ close?: number | string }>;
    };
    const closes = (body.candles ?? [])
      .map((c) => Number(c.close))
      .filter((v) => Number.isFinite(v) && v > 0);
    return closes.length >= 2 ? closes : null;
  } catch {
    return null;
  }
}

function getCloses(asset: string): Promise<number[] | null> {
  const hit = cache.get(asset);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;
  const promise = fetchCloses(asset);
  cache.set(asset, { at: Date.now(), promise });
  return promise;
}

/** Close series for `asset` (null = loading/unavailable/no asset). */
export function useMiniCandles(asset: string | null): number[] | null {
  const [closes, setCloses] = useState<number[] | null>(null);

  useEffect(() => {
    if (!asset) {
      setCloses(null);
      return;
    }
    let mounted = true;
    void getCloses(asset).then((c) => {
      if (mounted) setCloses(c);
    });
    return () => {
      mounted = false;
    };
  }, [asset]);

  return asset ? closes : null;
}
