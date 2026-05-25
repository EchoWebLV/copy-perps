// lib/data/marks.ts

const PAC_BASE = "https://api.pacifica.fi/api/v1";

// Every symbol any bot trades. ALL marks come from Pacifica — the
// arena's native exchange: the bots' source whales, their candles, and
// their execution model are all Pacifica too. BTC/ETH/SOL used to come
// from Hyperliquid's `allMids`, but HL rate-limited (429) the poll load
// hard even with caching + retries. Pacifica sourcing is consistent
// and 429-free, and a Pacifica BTC mark is the right price to value a
// mirror of a Pacifica whale's BTC position anyway.
const MARK_SYMBOLS = ["BTC", "ETH", "SOL", "XAU", "SP500"] as const;

// Snapshot cache TTL. The feed roster polls getMarksSnapshot every ~4s
// and the resolver ticks call it too; a 15s cache collapses all of
// that onto ~4 refreshes/min. The live UI price ticking runs off the
// Pacifica WS, so a slightly staler server snapshot costs nothing.
const TTL_MS = 15_000;

let _cache: { marks: Map<string, number>; expiresAt: number } | null = null;
// Last good value per symbol. If one symbol's fetch misses on a
// refresh, we carry its previous mark so it never blanks mid-tick.
const _lastMarks = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Last-trade price for one Pacifica symbol via /trades. Retries on 429
 * with a short backoff. Returns null if every attempt fails.
 */
async function fetchPacificaMark(symbol: string): Promise<number | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${PAC_BASE}/trades?symbol=${symbol}&limit=1`, {
        cache: "no-store",
      });
      if (r.status === 429 && attempt < 2) {
        await sleep(500 * (attempt + 1)); // 500ms, then 1000ms
        continue;
      }
      if (!r.ok) return null;
      const d = (await r.json()) as {
        success: boolean;
        data?: Array<{ price?: string | number }>;
      };
      if (!d.success || !Array.isArray(d.data) || d.data.length === 0) {
        return null;
      }
      const px = Number(d.data[0].price);
      return Number.isFinite(px) && px > 0 ? px : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Returns a map of symbol → mark for every symbol the bots trade, all
 * sourced from Pacifica. Cached for TTL_MS. A symbol whose fetch fails
 * carries its last good value, so a transient miss never leaves the
 * resolver blind on that market.
 */
export async function getMarksSnapshot(): Promise<Map<string, number>> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.marks;

  const marks = new Map<string, number>();
  await Promise.all(
    MARK_SYMBOLS.map(async (sym) => {
      const px = await fetchPacificaMark(sym);
      const value = px ?? _lastMarks.get(sym);
      if (value != null) {
        marks.set(sym, value);
        if (px != null) _lastMarks.set(sym, px);
      }
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
  const cached = snap.get(symbol);
  if (cached != null) return cached;

  const px = await fetchPacificaMark(symbol);
  if (px == null) return null;
  _lastMarks.set(symbol, px);
  if (_cache) {
    _cache.marks.set(symbol, px);
  }
  return px;
}
