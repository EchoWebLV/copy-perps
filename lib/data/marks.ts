// lib/data/marks.ts

const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
const PAC_BASE = "https://api.pacifica.fi/api/v1";

// Symbols that Hyperliquid doesn't list (gold, S&P, FX, single stocks)
// but Pacifica does. The resolver still needs server-side marks for
// these so scalper-style bots trading them can size trades and
// evaluate exits. We pull the most recent trade price from Pacifica's
// /trades endpoint for each. Add more here as new scalpers come on.
const PACIFICA_ONLY_SYMBOLS = ["XAU", "SP500", "XAG", "EURUSD", "USDJPY"] as const;

// Snapshot cache TTL. Bumped to 15s (from 5s): the feed roster polls
// getMarksSnapshot every ~4s and the resolver ticks call it too, so a
// 5s cache missed constantly and hammered Hyperliquid's allMids ~12x/
// min — enough to trip HL's 429. At 15s it's ~4 fetches/min, shared by
// every caller. The live UI price ticking runs off the Pacifica WS, so
// a slightly staler server-side snapshot costs the resolver nothing.
const TTL_MS = 15_000;

let _cache: { marks: Map<string, number>; expiresAt: number } | null = null;
// Last successful HL allMids result. If a refetch 429s or errors, we
// fall back to this so BTC/ETH/SOL marks never blank out mid-tick —
// the old code would cache a majors-less snapshot and starve the
// whale-bundle bots for a full TTL window.
let _lastHlMarks: Map<string, number> | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPacificaMark(symbol: string): Promise<number | null> {
  try {
    const r = await fetch(`${PAC_BASE}/trades?symbol=${symbol}&limit=1`, {
      cache: "no-store",
    });
    if (!r.ok) return null;
    const d = (await r.json()) as {
      success: boolean;
      data?: Array<{ price?: string | number }>;
    };
    if (!d.success || !Array.isArray(d.data) || d.data.length === 0) return null;
    const px = Number(d.data[0].price);
    return Number.isFinite(px) && px > 0 ? px : null;
  } catch {
    return null;
  }
}

/**
 * Fetch Hyperliquid `allMids` (crypto majors + the 200+ HL perps).
 * Retries on 429 with a short backoff — HL rate-limits this endpoint
 * under poll load. Returns null if every attempt fails, in which case
 * the caller falls back to the last good snapshot.
 */
async function fetchHlMids(): Promise<Map<string, number> | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(HL_INFO_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "allMids" }),
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as Record<string, string>;
        const m = new Map<string, number>();
        for (const [symbol, priceStr] of Object.entries(data)) {
          const price = Number(priceStr);
          if (Number.isFinite(price) && price > 0) m.set(symbol, price);
        }
        return m;
      }
      if (res.status === 429 && attempt < 2) {
        await sleep(600 * (attempt + 1)); // 600ms, then 1200ms
        continue;
      }
      console.error("[marks] HL allMids failed:", res.status);
      return null;
    } catch (err) {
      console.error("[marks] HL fetch error:", err);
      return null;
    }
  }
  return null;
}

/**
 * Returns a map of symbol → mark. Crypto symbols come from
 * Hyperliquid's `allMids`; non-crypto / Pacifica-only symbols (XAU,
 * SP500, FX) are topped up from Pacifica's /trades. Cached for TTL_MS.
 * On an HL failure the last good HL marks are reused, so a transient
 * 429 never leaves the resolver blind on BTC/ETH/SOL.
 */
export async function getMarksSnapshot(): Promise<Map<string, number>> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.marks;

  const fresh = await fetchHlMids();
  if (fresh && fresh.size > 0) _lastHlMarks = fresh;
  // Fresh HL marks if we got them, else the last good ones (stale but
  // present), else empty.
  const hl =
    (fresh && fresh.size > 0 ? fresh : _lastHlMarks) ??
    new Map<string, number>();

  const marks = new Map<string, number>(hl);

  // Pacifica-only marks for non-crypto symbols. Pulled in parallel so
  // the extra REST calls don't add latency. Each is tolerated to fail
  // without poisoning the snapshot.
  await Promise.all(
    PACIFICA_ONLY_SYMBOLS.map(async (sym) => {
      const px = await fetchPacificaMark(sym);
      if (px != null) marks.set(sym, px);
    }),
  );

  // Cache only a non-empty snapshot. Empty = total failure; keep the
  // previous cache so the resolver isn't blind.
  if (marks.size > 0) {
    _cache = { marks, expiresAt: Date.now() + TTL_MS };
    return marks;
  }
  return _cache?.marks ?? new Map();
}

export async function getMark(symbol: string): Promise<number | null> {
  const snap = await getMarksSnapshot();
  return snap.get(symbol) ?? null;
}
