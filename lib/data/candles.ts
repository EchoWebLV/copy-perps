// lib/data/candles.ts

const HL_INFO_URL = "https://api.hyperliquid.xyz/info";

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface Candle {
  ts: number; // open time, unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface HLCandle {
  t: number;
  T: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  n: number;
  i: string;
  s: string;
}

const INTERVAL_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

const TTL_MS = 30_000;

type CacheKey = string;
const _cache = new Map<CacheKey, { candles: Candle[]; expiresAt: number }>();

/**
 * Fetches the most recent `count` candles for an asset from Hyperliquid.
 * Returned in chronological order (oldest first). Cached per
 * (asset, timeframe, count) for 30s.
 */
export async function getCandles(
  asset: string,
  timeframe: Timeframe,
  count: number = 100,
): Promise<Candle[]> {
  const key = `${asset}|${timeframe}|${count}`;
  const cached = _cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.candles;

  const now = Date.now();
  const startTime = now - (count + 1) * INTERVAL_MS[timeframe];

  try {
    const res = await fetch(HL_INFO_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: {
          coin: asset,
          interval: timeframe,
          startTime,
          endTime: now,
        },
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[candles] fetch failed:", res.status);
      return cached?.candles ?? [];
    }
    const raw = (await res.json()) as HLCandle[];
    if (!Array.isArray(raw)) return cached?.candles ?? [];
    const parsed: Candle[] = raw
      .map((c) => ({
        ts: c.t,
        open: Number(c.o),
        high: Number(c.h),
        low: Number(c.l),
        close: Number(c.c),
        volume: Number(c.v),
      }))
      .filter(
        (c) =>
          Number.isFinite(c.open) &&
          Number.isFinite(c.close) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low),
      )
      .sort((a, b) => a.ts - b.ts)
      .slice(-count);
    _cache.set(key, { candles: parsed, expiresAt: now + TTL_MS });
    return parsed;
  } catch (err) {
    console.error("[candles] fetch error:", err);
    return cached?.candles ?? [];
  }
}
