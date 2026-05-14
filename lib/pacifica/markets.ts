import type { PacificaMarketInfo } from "./types";
import { getMarkets } from "./client";

const TTL_MS = 60 * 60 * 1000;
let _cache: { markets: PacificaMarketInfo[]; expiresAt: number } | null = null;

export async function getMarketsCached(): Promise<PacificaMarketInfo[]> {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.markets;
  const fresh = await getMarkets();
  _cache = { markets: fresh, expiresAt: Date.now() + TTL_MS };
  return fresh;
}

export async function getMarketBySymbol(
  symbol: string,
): Promise<PacificaMarketInfo | null> {
  const all = await getMarketsCached();
  return all.find((m) => m.symbol === symbol) ?? null;
}

// Pacifica exposes a flat max_leverage per market (e.g. BTC=50, smaller
// alts are lower). No notional-tier table at this time, so we just
// return the per-market cap.
export async function getMaxLeverage(symbol: string): Promise<number> {
  const m = await getMarketBySymbol(symbol);
  if (!m) throw new Error(`Unknown Pacifica market: ${symbol}`);
  return m.max_leverage;
}

// Clamp the leader's leverage to what Pacifica permits on this market.
// (Identical to getMaxLeverage today, but isolated as a helper so we
// can add notional-tier logic later without changing call sites.)
export async function clampLeverageForNotional(
  symbol: string,
  _notionalUsd: number,
): Promise<number> {
  return getMaxLeverage(symbol);
}
