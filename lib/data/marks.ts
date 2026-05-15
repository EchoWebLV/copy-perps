// lib/data/marks.ts

const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
const PAC_BASE = "https://api.pacifica.fi/api/v1";

// Symbols that Hyperliquid doesn't list (gold, S&P, FX, single stocks)
// but Pacifica does. The resolver still needs server-side marks for
// these so scalper-style bots trading them can size trades and
// evaluate exits. We pull the most recent trade price from Pacifica's
// /trades endpoint for each. Add more here as new scalpers come on.
const PACIFICA_ONLY_SYMBOLS = ["XAU", "SP500", "XAG", "EURUSD", "USDJPY"] as const;

/**
 * Returns a map of symbol → mark. Crypto symbols come from
 * Hyperliquid's `allMids` (covers BTC/ETH/SOL plus the 200+ HL perps).
 * Non-crypto / Pacifica-only symbols (XAU, SP500, FX, etc.) are
 * topped up from Pacifica's /trades endpoint so server-side strategies
 * trading them have a mark to size against. Cached for 5s.
 */
let _cache: { marks: Map<string, number>; expiresAt: number } | null = null;
const TTL_MS = 5_000;

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

export async function getMarksSnapshot(): Promise<Map<string, number>> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.marks;
  const marks = new Map<string, number>();

  // HL allMids — crypto majors
  try {
    const res = await fetch(HL_INFO_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as Record<string, string>;
      for (const [symbol, priceStr] of Object.entries(data)) {
        const price = Number(priceStr);
        if (Number.isFinite(price) && price > 0) {
          marks.set(symbol, price);
        }
      }
    } else {
      console.error("[marks] HL allMids failed:", res.status);
    }
  } catch (err) {
    console.error("[marks] HL fetch error:", err);
  }

  // Pacifica-only marks for non-crypto symbols. Pulled in parallel so
  // the extra ~5 REST calls don't add latency to the tick. Each is
  // tolerated to fail without poisoning the snapshot.
  await Promise.all(
    PACIFICA_ONLY_SYMBOLS.map(async (sym) => {
      const px = await fetchPacificaMark(sym);
      if (px != null) marks.set(sym, px);
    }),
  );

  // Cache only if we got SOMETHING. Empty snapshot = transient failure;
  // keep the previous cache so the resolver isn't blind.
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
