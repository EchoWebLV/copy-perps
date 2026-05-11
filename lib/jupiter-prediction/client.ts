const BASE = "https://api.jup.ag/prediction/v1";

export interface JPMarket {
  marketId: string;
  status: string;
  result: string | null;
  marketResultPubkey: string | null;
  title: string;
  openTime: number;
  closeTime: number;
  isTeamMarket: boolean;
  rulesPrimary?: string;
  rulesSecondary?: string;
  resolveAt: number | null;
  pricing: {
    buyYesPriceUsd: number;
    sellYesPriceUsd: number;
    sellNoPriceUsd: number;
    buyNoPriceUsd: number;
    volume: number;
  };
  imageUrl: string | null;
  team: unknown;
  outcomes: string[];
  outcomePrices?: string[];
  clobTokenIds: string[];
  resolution: string | null;
}

// Jupiter Prediction's `/events` payload no longer ships `outcomePrices`;
// the YES side price now lives in `pricing.buyYesPriceUsd` as micro-USD
// (1e6 = $1.00 = implied 100%). Older payloads (and `/markets/{id}` on some
// edges) still include `outcomePrices`, so fall back to it.
export function marketYesProbability(market: JPMarket): number {
  const buy = market.pricing?.buyYesPriceUsd;
  if (typeof buy === "number" && Number.isFinite(buy) && buy > 0) {
    return buy / 1_000_000;
  }
  const fallback = parseFloat(market.outcomePrices?.[0] ?? "0");
  return Number.isFinite(fallback) ? fallback : 0;
}

export interface JPEvent {
  eventId: string;
  isActive: boolean;
  isLive: boolean;
  category: string;
  subcategory?: string;
  tags?: string[];
  metadata: {
    slug?: string;
    title: string;
    isLive?: boolean;
    series?: string;
    eventId?: string;
    imageUrl?: string;
    subtitle?: string;
    closeTime?: string;
  };
  volumeUsd: string;
  volume24hr: string;
  beginAt: string;
  closeCondition?: string;
  rulesPdf?: string;
  markets: JPMarket[];
}

export async function listEvents(params?: {
  limit?: number;
  category?: string;
  active?: boolean;
}): Promise<JPEvent[]> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", params.limit.toString());
  if (params?.category) qs.set("category", params.category);
  if (params?.active !== undefined) qs.set("active", String(params.active));

  const url = `${BASE}/events${qs.toString() ? `?${qs}` : ""}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Jupiter Prediction events: ${r.status} ${txt}`);
  }
  const data = (await r.json()) as { data?: JPEvent[] };
  return data.data ?? [];
}

export async function getEvent(eventId: string): Promise<JPEvent | null> {
  const r = await fetch(`${BASE}/events/${eventId}`, { cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Jupiter Prediction event: ${r.status} ${txt}`);
  }
  const data = (await r.json()) as { data?: JPEvent };
  return data.data ?? null;
}

export interface JPOrder {
  orderPubkey: string | null;
  positionPubkey: string | null;
  userPubkey: string;
  marketId: string;
  isBuy: boolean;
  isYes: boolean;
  contracts: string;
  newContracts: string;
  maxBuyPriceUsd: string | null;
  minSellPriceUsd: string | null;
  orderCostUsd: string;
  newAvgPriceUsd: string;
  newSizeUsd: string;
  newPayoutUsd: string;
  estimatedTotalFeeUsd: string;
}

export interface JPOrderResponse {
  transaction: string | null;
  txMeta: {
    blockhash: string;
    lastValidBlockHeight: number;
  } | null;
  externalOrderId: string | null;
  requiredSigners: string[];
  order: JPOrder;
}

export const PREDICTION_USDC_MINT =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export async function createOrder(params: {
  ownerPubkey: string;
  marketId: string;
  isYes: boolean;
  isBuy: boolean;
  depositAmountMicroUsd: bigint | string;
  depositMint?: string;
}): Promise<JPOrderResponse> {
  const r = await fetch(`${BASE}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ownerPubkey: params.ownerPubkey,
      marketId: params.marketId,
      isYes: params.isYes,
      isBuy: params.isBuy,
      depositAmount: params.depositAmountMicroUsd.toString(),
      depositMint: params.depositMint ?? PREDICTION_USDC_MINT,
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Jupiter Prediction createOrder: ${r.status} ${txt}`);
  }
  return (await r.json()) as JPOrderResponse;
}

export async function getMarket(marketId: string): Promise<JPMarket | null> {
  const r = await fetch(`${BASE}/markets/${marketId}`, { cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Jupiter Prediction market: ${r.status} ${txt}`);
  }
  // /markets/{id} returns the market directly, not wrapped in { data }
  return (await r.json()) as JPMarket;
}

export interface JPClosePositionResponse {
  transaction: string | null;
  txMeta: {
    blockhash: string;
    lastValidBlockHeight: number;
  } | null;
  order: JPOrder;
}

export interface JPPosition {
  pubkey: string;
  owner: string;
  ownerPubkey: string;
  market: string;
  marketId: string;
  isYes: boolean;
  contracts: string;
  totalCostUsd: string;
  sizeUsd: string;
  // Mark-to-market value in micro-USD. Null once the market is resolved.
  valueUsd: string | null;
  avgPriceUsd: string;
  markPriceUsd: string | null;
  sellPriceUsd: string | null;
  pnlUsd: string | null;
}

export async function getPosition(
  positionPubkey: string,
): Promise<JPPosition | null> {
  const r = await fetch(`${BASE}/positions/${positionPubkey}`, {
    cache: "no-store",
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Jupiter Prediction position: ${r.status} ${txt}`);
  }
  const raw = (await r.json()) as { data?: JPPosition } | JPPosition;
  if (raw && typeof raw === "object" && "data" in raw && raw.data) {
    return raw.data;
  }
  return raw as JPPosition;
}

export async function closePosition(
  positionPubkey: string,
  ownerPubkey: string,
): Promise<JPClosePositionResponse> {
  // Jupiter Prediction's DELETE /positions/:pk expects the owner pubkey in
  // the JSON body, not the query string. The query-string form returns
  // "ownerPubkey or userPubkey is required" even though both are present.
  const r = await fetch(`${BASE}/positions/${positionPubkey}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerPubkey }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Jupiter Prediction close: ${r.status} ${txt}`);
  }
  return (await r.json()) as JPClosePositionResponse;
}

