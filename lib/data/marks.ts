// lib/data/marks.ts

const HL_INFO_URL = "https://api.hyperliquid.xyz/info";

/**
 * Returns a map of symbol → mark for crypto perp markets, sampled from
 * Hyperliquid's `allMids` REST endpoint. Cached for 5s to avoid hammering
 * the API when the resolver tick is short. Hyperliquid marks track
 * Pacifica's for shared majors closely enough for paper-PnL purposes.
 */
let _cache: { marks: Map<string, number>; expiresAt: number } | null = null;
const TTL_MS = 5_000;

export async function getMarksSnapshot(): Promise<Map<string, number>> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.marks;
  try {
    const res = await fetch(HL_INFO_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[marks] HL allMids failed:", res.status);
      return _cache?.marks ?? new Map();
    }
    const data = (await res.json()) as Record<string, string>;
    const marks = new Map<string, number>();
    for (const [symbol, priceStr] of Object.entries(data)) {
      const price = Number(priceStr);
      if (Number.isFinite(price) && price > 0) {
        marks.set(symbol, price);
      }
    }
    _cache = { marks, expiresAt: Date.now() + TTL_MS };
    return marks;
  } catch (err) {
    console.error("[marks] fetch error:", err);
    return _cache?.marks ?? new Map();
  }
}

export async function getMark(symbol: string): Promise<number | null> {
  const snap = await getMarksSnapshot();
  return snap.get(symbol) ?? null;
}
