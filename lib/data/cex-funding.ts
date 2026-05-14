// lib/data/cex-funding.ts
//
// Aggregates 1-period funding rates from Binance, Bybit, OKX, dYdX.
// Per-asset signal: average rate + count of venues agreeing on direction.
// Funding Phoebe gates on venuesAgreed; the strategy's edge depends on
// real cross-venue consensus, not Binance-only outliers.

const TTL_MS = 30_000;
const ASSETS = ["BTC", "ETH", "SOL", "HYPE", "BNB", "XRP", "DOGE", "AVAX"];

export interface FundingSignal {
  avgRate: number;
  venuesAgreed: number;
  venuesQueried: number;
  perVenue: Record<string, number>;
}

interface VenueFetcher {
  name: string;
  fetch(): Promise<Record<string, number>>;
}

// ── Symbol maps ───────────────────────────────────────────────────────────────

const BINANCE_SYMBOL: Record<string, string> = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  HYPE: "HYPEUSDT",
  BNB: "BNBUSDT",
  XRP: "XRPUSDT",
  DOGE: "DOGEUSDT",
  AVAX: "AVAXUSDT",
};

const BYBIT_SYMBOL: Record<string, string> = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  HYPE: "HYPEUSDT",
  BNB: "BNBUSDT",
  XRP: "XRPUSDT",
  DOGE: "DOGEUSDT",
  AVAX: "AVAXUSDT",
};

const OKX_SYMBOL: Record<string, string> = {
  BTC: "BTC-USDT-SWAP",
  ETH: "ETH-USDT-SWAP",
  SOL: "SOL-USDT-SWAP",
  HYPE: "HYPE-USDT-SWAP",
  BNB: "BNB-USDT-SWAP",
  XRP: "XRP-USDT-SWAP",
  DOGE: "DOGE-USDT-SWAP",
  AVAX: "AVAX-USDT-SWAP",
};

const DYDX_SYMBOL: Record<string, string> = {
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  SOL: "SOL-USD",
  HYPE: "HYPE-USD",
  BNB: "BNB-USD",
  XRP: "XRP-USD",
  DOGE: "DOGE-USD",
  AVAX: "AVAX-USD",
};

// ── Venue fetchers ────────────────────────────────────────────────────────────

interface BinancePremiumIndex {
  symbol: string;
  lastFundingRate: string;
}

async function fetchBinanceFunding(): Promise<Record<string, number>> {
  try {
    const res = await fetch("https://fapi.binance.com/fapi/v1/premiumIndex", {
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[binance funding]", res.status);
      return {};
    }
    const all = (await res.json()) as BinancePremiumIndex[];
    const out: Record<string, number> = {};
    for (const [asset, sym] of Object.entries(BINANCE_SYMBOL)) {
      const row = all.find((r) => r.symbol === sym);
      if (row) out[asset] = Number(row.lastFundingRate);
    }
    return out;
  } catch (err) {
    console.error("[binance funding] fetch error:", err);
    return {};
  }
}

interface BybitTicker {
  symbol: string;
  fundingRate: string;
}

interface BybitResponse {
  result: {
    list: BybitTicker[];
  };
}

async function fetchBybitFunding(): Promise<Record<string, number>> {
  // GET https://api.bybit.com/v5/market/tickers?category=linear
  // response: {result: {list: [{symbol: "BTCUSDT", fundingRate: "0.00012", ...}]}}
  try {
    const res = await fetch(
      "https://api.bybit.com/v5/market/tickers?category=linear",
      { cache: "no-store" },
    );
    if (!res.ok) {
      console.error("[bybit funding]", res.status);
      return {};
    }
    const data = (await res.json()) as BybitResponse;
    const list = data?.result?.list ?? [];
    // Build reverse map: bybit symbol → internal asset
    const reverseMap: Record<string, string> = {};
    for (const [asset, sym] of Object.entries(BYBIT_SYMBOL)) {
      reverseMap[sym] = asset;
    }
    const out: Record<string, number> = {};
    for (const ticker of list) {
      const asset = reverseMap[ticker.symbol];
      if (asset && ticker.fundingRate !== undefined) {
        out[asset] = Number(ticker.fundingRate);
      }
    }
    return out;
  } catch (err) {
    console.error("[bybit funding] fetch error:", err);
    return {};
  }
}

interface OkxFundingData {
  instId: string;
  fundingRate: string;
}

interface OkxResponse {
  code: string;
  data: OkxFundingData[];
}

async function fetchOkxFunding(): Promise<Record<string, number>> {
  // GET https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP (per asset)
  // response per call: {code: "0", data: [{instId: "...", fundingRate: "0.0001", ...}]}
  const settled = await Promise.allSettled(
    ASSETS.map(async (asset) => {
      const instId = OKX_SYMBOL[asset];
      const res = await fetch(
        `https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`okx ${asset} ${res.status}`);
      const data = (await res.json()) as OkxResponse;
      const row = data?.data?.[0];
      if (!row) throw new Error(`okx ${asset} no data`);
      return { asset, rate: Number(row.fundingRate) };
    }),
  );

  const out: Record<string, number> = {};
  for (const result of settled) {
    if (result.status === "fulfilled") {
      out[result.value.asset] = result.value.rate;
    } else {
      console.error("[okx funding] per-asset error:", result.reason);
    }
  }
  return out;
}

interface DydxMarket {
  nextFundingRate: string;
}

interface DydxResponse {
  markets: Record<string, DydxMarket>;
}

async function fetchDydxFunding(): Promise<Record<string, number>> {
  // GET https://indexer.dydx.trade/v4/perpetualMarkets
  // response: {markets: {"BTC-USD": {nextFundingRate: "0.0001", ...}, ...}}
  try {
    const res = await fetch("https://indexer.dydx.trade/v4/perpetualMarkets", {
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[dydx funding]", res.status);
      return {};
    }
    const data = (await res.json()) as DydxResponse;
    const markets = data?.markets ?? {};
    const out: Record<string, number> = {};
    for (const [asset, dydxSym] of Object.entries(DYDX_SYMBOL)) {
      const market = markets[dydxSym];
      if (market?.nextFundingRate !== undefined) {
        out[asset] = Number(market.nextFundingRate);
      }
    }
    return out;
  } catch (err) {
    console.error("[dydx funding] fetch error:", err);
    return {};
  }
}

// ── Aggregator ────────────────────────────────────────────────────────────────

const VENUES: VenueFetcher[] = [
  { name: "binance", fetch: fetchBinanceFunding },
  { name: "bybit", fetch: fetchBybitFunding },
  { name: "okx", fetch: fetchOkxFunding },
  { name: "dydx", fetch: fetchDydxFunding },
];

let _cache: {
  signals: Record<string, FundingSignal>;
  expiresAt: number;
} | null = null;

/**
 * Returns a map of internal asset code → FundingSignal aggregated across
 * Binance, Bybit, OKX, and dYdX. Cached for 30s.
 * Survives individual venue failures — failed venues simply contribute 0 data.
 */
export async function getFundingRates(): Promise<
  Record<string, FundingSignal>
> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.signals;

  const results = await Promise.allSettled(VENUES.map((v) => v.fetch()));
  const out: Record<string, FundingSignal> = {};

  for (const asset of ASSETS) {
    const perVenue: Record<string, number> = {};
    for (let i = 0; i < VENUES.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled" && r.value[asset] !== undefined) {
        perVenue[VENUES[i].name] = r.value[asset];
      }
    }
    const rates = Object.values(perVenue);
    if (rates.length === 0) continue;
    const avgRate = rates.reduce((s, r) => s + r, 0) / rates.length;
    const venuesAgreed = rates.filter(
      (r) => Math.sign(r) === Math.sign(avgRate) && Math.abs(r) > 0,
    ).length;
    out[asset] = {
      avgRate,
      venuesAgreed,
      venuesQueried: rates.length,
      perVenue,
    };
  }

  _cache = { signals: out, expiresAt: Date.now() + TTL_MS };
  return out;
}
