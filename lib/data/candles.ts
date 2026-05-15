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
// Big enough that every strategy's count fits inside it — slice on read
// instead of re-fetching with a smaller window.
const FETCH_BUFFER = 200;

type CacheKey = string;
const _cache = new Map<
  CacheKey,
  { candles: Candle[]; expiresAt: number; inflight: Promise<Candle[]> | null }
>();

/**
 * Fetches the most recent `count` candles for an asset from Hyperliquid.
 * Returned in chronological order (oldest first). The cache stores up to
 * `FETCH_BUFFER` candles per (asset, timeframe) so a single fetch serves
 * every caller's `count` from a sliced view — keeps the request rate to
 * HL flat regardless of how many strategies ask for different windows.
 *
 * Concurrent calls during a cache miss share the same in-flight promise
 * so we never fire duplicate requests within the same tick.
 */
export async function getCandles(
  asset: string,
  timeframe: Timeframe,
  count: number = 100,
): Promise<Candle[]> {
  const key = `${asset}|${timeframe}`;
  const now = Date.now();
  const cached = _cache.get(key);
  if (cached && cached.expiresAt > now && cached.candles.length >= count) {
    return cached.candles.slice(-count);
  }
  if (cached?.inflight) {
    const candles = await cached.inflight;
    return candles.slice(-count);
  }

  const fetchCount = Math.max(count, FETCH_BUFFER);
  const startTime = now - (fetchCount + 1) * INTERVAL_MS[timeframe];

  const inflight = (async () => {
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
        .slice(-fetchCount);
      _cache.set(key, {
        candles: parsed,
        expiresAt: now + TTL_MS,
        inflight: null,
      });
      return parsed;
    } catch (err) {
      console.error("[candles] fetch error:", err);
      _cache.set(key, {
        candles: cached?.candles ?? [],
        expiresAt: cached?.expiresAt ?? 0,
        inflight: null,
      });
      return cached?.candles ?? [];
    }
  })();

  _cache.set(key, {
    candles: cached?.candles ?? [],
    expiresAt: cached?.expiresAt ?? 0,
    inflight,
  });

  const candles = await inflight;
  return candles.slice(-count);
}
