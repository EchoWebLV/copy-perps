import { OSTIUM_SUBGRAPH_URL } from "./ostium-markets";
import type { OstiumRawTrade } from "./ostium-source";

const TRADE_FIELDS = `
    tradeID
    trader
    collateral
    leverage
    notional
    openPrice
    isBuy
    isOpen
    timestamp
    index
    pair { id from to lastTradePrice }`;

export function buildDiscoverQuery(
  pairIds: string[],
  perMarket: number,
): string {
  const aliases = pairIds
    .map(
      (id) =>
        `  p${id}: trades(first: ${perMarket}, orderBy: tradeNotional, orderDirection: desc, where: { isOpen: true, pair: "${id}" }) {${TRADE_FIELDS}\n  }`,
    )
    .join("\n");
  return `query Discover {\n${aliases}\n}`;
}

export function parseDiscoverResponse(
  json: unknown,
  pairIds: string[],
): OstiumRawTrade[] {
  const body = json as {
    data?: Record<string, OstiumRawTrade[] | null>;
    errors?: unknown;
  };
  if (body.errors) {
    throw new Error(`Ostium subgraph errors: ${JSON.stringify(body.errors)}`);
  }
  const data = body.data ?? {};
  const out: OstiumRawTrade[] = [];
  for (const id of pairIds) {
    const bucket = data[`p${id}`];
    if (Array.isArray(bucket)) out.push(...bucket);
  }
  return out;
}

export async function fetchOstiumTopTradesByMarket(
  pairIds: string[],
  perMarket: number,
  timeoutMs = 10_000,
): Promise<OstiumRawTrade[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OSTIUM_SUBGRAPH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: buildDiscoverQuery(pairIds, perMarket) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Ostium subgraph HTTP ${res.status}`);
    }
    return parseDiscoverResponse(await res.json(), pairIds);
  } finally {
    clearTimeout(timer);
  }
}
