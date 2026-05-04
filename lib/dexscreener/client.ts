const BASE = "https://api.dexscreener.com";

export interface DSBoost {
  url: string;
  chainId: string;
  tokenAddress: string;
  amount?: number;
  totalAmount?: number;
  icon?: string;
  header?: string;
  description?: string;
}

export interface DSPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative: string;
  priceUsd: string;
  priceChange: { m5?: number; h1?: number; h6?: number; h24?: number };
  volume: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns: {
    m5?: { buys: number; sells: number };
    h1?: { buys: number; sells: number };
    h6?: { buys: number; sells: number };
    h24?: { buys: number; sells: number };
  };
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
}

export async function getTopBoosted(): Promise<DSBoost[]> {
  const r = await fetch(`${BASE}/token-boosts/top/v1`, {
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`DexScreener boosted: ${r.status}`);
  const data = (await r.json()) as DSBoost[];
  return Array.isArray(data) ? data : [];
}

export async function getPairs(tokenAddress: string): Promise<DSPair[]> {
  const r = await fetch(`${BASE}/latest/dex/tokens/${tokenAddress}`, {
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`DexScreener tokens: ${r.status}`);
  const data = (await r.json()) as { pairs?: DSPair[] };
  return data.pairs ?? [];
}
