const BINANCE_DATA_BASE = "https://fapi.binance.com/futures/data";
const BINANCE_FAPI_BASE = "https://fapi.binance.com/fapi/v1";
const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
const CACHE_TTL_MS = 30_000;
const MAX_MARKETS = 20;
const DEFAULT_MARKETS = ["BTC", "ETH", "SOL", "HYPE", "BNB", "XRP", "DOGE", "AVAX"];

export type MarketBias = "long" | "short" | "balanced" | "unknown";

export interface BinanceMarketSentiment {
  symbol: string;
  topTraderLongPct: number | null;
  topTraderShortPct: number | null;
  topTraderLongShortRatio: number | null;
  topTraderAccountLongPct: number | null;
  topTraderAccountShortPct: number | null;
  globalLongPct: number | null;
  globalShortPct: number | null;
  openInterestUsd: number | null;
  takerBuySellRatio: number | null;
  takerBuyVol: number | null;
  takerSellVol: number | null;
  fundingRate: number | null;
  updatedAtMs: number | null;
}

export interface HyperliquidMarketContext {
  market: string;
  markPrice: number | null;
  openInterestBase: number | null;
  openInterestUsd: number | null;
  fundingRate: number | null;
  dayVolumeUsd: number | null;
}

export interface MarketSentiment {
  market: string;
  source: "binance+hyperliquid" | "binance" | "hyperliquid" | "none";
  binance: BinanceMarketSentiment | null;
  hyperliquid: HyperliquidMarketContext | null;
  longPct: number | null;
  shortPct: number | null;
  openInterestUsd: number | null;
  longPressureUsd: number | null;
  shortPressureUsd: number | null;
  fundingRate: number | null;
  bias: MarketBias;
  updatedAtMs: number;
}

interface BinanceRatioRow {
  symbol?: string;
  longShortRatio?: string;
  longAccount?: string;
  shortAccount?: string;
  timestamp?: number | string;
}

interface BinanceOpenInterestRow {
  sumOpenInterestValue?: string;
  timestamp?: number | string;
}

interface BinanceTakerRow {
  buySellRatio?: string;
  buyVol?: string;
  sellVol?: string;
  timestamp?: number | string;
}

interface BinancePremiumIndex {
  lastFundingRate?: string;
  time?: number;
}

interface HlUniverseItem {
  name?: string;
}

interface HlAssetContext {
  markPx?: string;
  midPx?: string;
  oraclePx?: string;
  openInterest?: string;
  funding?: string;
  dayNtlVlm?: string;
}

const marketCache = new Map<
  string,
  { value: MarketSentiment; expiresAt: number }
>();
let hyperliquidCache:
  | { value: Record<string, HyperliquidMarketContext>; expiresAt: number }
  | null = null;

export async function getMarketSentimentSnapshot(
  requestedMarkets = DEFAULT_MARKETS,
): Promise<Record<string, MarketSentiment>> {
  const markets = normalizeMarkets(requestedMarkets);
  if (markets.length === 0) return {};

  const hyperliquidByMarket = await getHyperliquidContexts();
  const entries = await Promise.all(
    markets.map(async (market) => {
      const cached = marketCache.get(market);
      if (cached && cached.expiresAt > Date.now()) {
        return [market, cached.value] as const;
      }

      const sentiment = await buildMarketSentiment(
        market,
        hyperliquidByMarket[market] ?? null,
      );
      marketCache.set(market, {
        value: sentiment,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return [market, sentiment] as const;
    }),
  );

  return Object.fromEntries(entries);
}

export function _clearMarketSentimentCache() {
  marketCache.clear();
  hyperliquidCache = null;
}

function normalizeMarkets(markets: string[]): string[] {
  const unique = new Set<string>();
  for (const market of markets) {
    const normalized = market.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(normalized)) continue;
    unique.add(normalized);
  }
  return [...unique].slice(0, MAX_MARKETS);
}

async function buildMarketSentiment(
  market: string,
  hyperliquid: HyperliquidMarketContext | null,
): Promise<MarketSentiment> {
  const binance = await fetchBinanceMarketSentiment(market);
  const openInterestUsd =
    binance?.openInterestUsd ?? hyperliquid?.openInterestUsd ?? null;
  const longPct = binance?.topTraderLongPct ?? null;
  const shortPct = binance?.topTraderShortPct ?? null;
  const hasSplit = longPct != null && shortPct != null && openInterestUsd != null;
  const longPressureUsd = hasSplit ? (openInterestUsd * longPct) / 100 : null;
  const shortPressureUsd = hasSplit ? (openInterestUsd * shortPct) / 100 : null;

  return {
    market,
    source: sourceLabel(binance, hyperliquid),
    binance,
    hyperliquid,
    longPct,
    shortPct,
    openInterestUsd,
    longPressureUsd,
    shortPressureUsd,
    fundingRate: binance?.fundingRate ?? hyperliquid?.fundingRate ?? null,
    bias: getBias(longPct, shortPct),
    updatedAtMs: Math.max(
      binance?.updatedAtMs ?? 0,
      Date.now(),
    ),
  };
}

async function fetchBinanceMarketSentiment(
  market: string,
): Promise<BinanceMarketSentiment | null> {
  const symbol = `${market}USDT`;
  const [
    topPosition,
    topAccount,
    globalAccount,
    openInterest,
    takerFlow,
    premium,
  ] = await Promise.all([
    fetchBinanceArray<BinanceRatioRow>("topLongShortPositionRatio", symbol),
    fetchBinanceArray<BinanceRatioRow>("topLongShortAccountRatio", symbol),
    fetchBinanceArray<BinanceRatioRow>("globalLongShortAccountRatio", symbol),
    fetchBinanceArray<BinanceOpenInterestRow>("openInterestHist", symbol),
    fetchBinanceArray<BinanceTakerRow>("takerlongshortRatio", symbol),
    fetchBinancePremiumIndex(symbol),
  ]);

  const hasAny =
    topPosition || topAccount || globalAccount || openInterest || takerFlow || premium;
  if (!hasAny) return null;

  return {
    symbol,
    topTraderLongPct: toPct(topPosition?.longAccount),
    topTraderShortPct: toPct(topPosition?.shortAccount),
    topTraderLongShortRatio: toNumber(topPosition?.longShortRatio),
    topTraderAccountLongPct: toPct(topAccount?.longAccount),
    topTraderAccountShortPct: toPct(topAccount?.shortAccount),
    globalLongPct: toPct(globalAccount?.longAccount),
    globalShortPct: toPct(globalAccount?.shortAccount),
    openInterestUsd: toNumber(openInterest?.sumOpenInterestValue),
    takerBuySellRatio: toNumber(takerFlow?.buySellRatio),
    takerBuyVol: toNumber(takerFlow?.buyVol),
    takerSellVol: toNumber(takerFlow?.sellVol),
    fundingRate: toNumber(premium?.lastFundingRate),
    updatedAtMs: maxTimestamp([
      topPosition?.timestamp,
      topAccount?.timestamp,
      globalAccount?.timestamp,
      openInterest?.timestamp,
      takerFlow?.timestamp,
      premium?.time,
    ]),
  };
}

async function fetchBinanceArray<T>(
  endpoint: string,
  symbol: string,
): Promise<T | null> {
  const url = new URL(`${BINANCE_DATA_BASE}/${endpoint}`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("period", "5m");
  url.searchParams.set("limit", "1");

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? ((data[0] ?? null) as T | null) : null;
  } catch {
    return null;
  }
}

async function fetchBinancePremiumIndex(
  symbol: string,
): Promise<BinancePremiumIndex | null> {
  const url = new URL(`${BINANCE_FAPI_BASE}/premiumIndex`);
  url.searchParams.set("symbol", symbol);

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    return data && !Array.isArray(data) ? (data as BinancePremiumIndex) : null;
  } catch {
    return null;
  }
}

async function getHyperliquidContexts(): Promise<
  Record<string, HyperliquidMarketContext>
> {
  if (hyperliquidCache && hyperliquidCache.expiresAt > Date.now()) {
    return hyperliquidCache.value;
  }

  try {
    const res = await fetch(HL_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      cache: "no-store",
    });
    if (!res.ok) return {};
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data) || !Array.isArray(data[1])) return {};
    const universe = ((data[0] as { universe?: HlUniverseItem[] })?.universe ??
      []) as HlUniverseItem[];
    const contexts = data[1] as HlAssetContext[];
    const out: Record<string, HyperliquidMarketContext> = {};

    for (let i = 0; i < universe.length; i++) {
      const market = universe[i]?.name?.trim().toUpperCase();
      const context = contexts[i];
      if (!market || !context) continue;
      const markPrice =
        toNumber(context.markPx) ?? toNumber(context.midPx) ?? toNumber(context.oraclePx);
      const openInterestBase = toNumber(context.openInterest);
      out[market] = {
        market,
        markPrice,
        openInterestBase,
        openInterestUsd:
          markPrice != null && openInterestBase != null
            ? markPrice * openInterestBase
            : null,
        fundingRate: toNumber(context.funding),
        dayVolumeUsd: toNumber(context.dayNtlVlm),
      };
    }

    hyperliquidCache = { value: out, expiresAt: Date.now() + CACHE_TTL_MS };
    return out;
  } catch {
    return {};
  }
}

function sourceLabel(
  binance: BinanceMarketSentiment | null,
  hyperliquid: HyperliquidMarketContext | null,
): MarketSentiment["source"] {
  if (binance && hyperliquid) return "binance+hyperliquid";
  if (binance) return "binance";
  if (hyperliquid) return "hyperliquid";
  return "none";
}

function getBias(longPct: number | null, shortPct: number | null): MarketBias {
  if (longPct == null || shortPct == null) return "unknown";
  const skew = Math.abs(longPct - shortPct);
  if (skew < 6) return "balanced";
  return longPct > shortPct ? "long" : "short";
}

function toPct(value: string | number | null | undefined): number | null {
  const num = toNumber(value);
  if (num == null) return null;
  const pct = num <= 1 ? num * 100 : num;
  return Math.round(pct * 100) / 100;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function maxTimestamp(values: Array<string | number | null | undefined>) {
  const timestamps = values
    .map(toNumber)
    .filter((value): value is number => value != null);
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}
