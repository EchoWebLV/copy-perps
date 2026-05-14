const BINANCE_FUNDING_URL =
  "https://fapi.binance.com/fapi/v1/premiumIndex";

interface BinancePremiumIndex {
  symbol: string;
  markPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  time: number;
}

const BINANCE_SYMBOL_MAP: Record<string, string> = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  HYPE: "HYPEUSDT",
  BNB: "BNBUSDT",
  XRP: "XRPUSDT",
  DOGE: "DOGEUSDT",
  AVAX: "AVAXUSDT",
};

let _cache: { funding: Record<string, number>; expiresAt: number } | null = null;
const TTL_MS = 30_000;

/**
 * Returns a map of our internal asset code → Binance funding rate
 * (1-period rate, not annualized). Cached for 30s. Phase 2 will fan-out to
 * Bybit, OKX, dYdX and return an aggregate.
 */
export async function getFundingRates(): Promise<Record<string, number>> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.funding;
  try {
    const res = await fetch(BINANCE_FUNDING_URL, { cache: "no-store" });
    if (!res.ok) {
      console.error("[binance funding]", res.status);
      return _cache?.funding ?? {};
    }
    const all = (await res.json()) as BinancePremiumIndex[];
    const out: Record<string, number> = {};
    for (const [internal, binSymbol] of Object.entries(BINANCE_SYMBOL_MAP)) {
      const row = all.find((r) => r.symbol === binSymbol);
      if (row) out[internal] = Number(row.lastFundingRate);
    }
    _cache = { funding: out, expiresAt: Date.now() + TTL_MS };
    return out;
  } catch (err) {
    console.error("[binance funding] fetch error:", err);
    return _cache?.funding ?? {};
  }
}
