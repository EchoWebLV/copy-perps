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
  outcomePrices: string[];
  clobTokenIds: string[];
  resolution: string | null;
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
