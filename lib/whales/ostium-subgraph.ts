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

/**
 * One query per market. A single aliased "mega-query" across all 17 markets
 * hangs the Ormi endpoint (super-linear in alias count), so we fan out instead.
 * Order by `notional` (USD value, indexed + fast) — NOT `tradeNotional` (the
 * 1e18 base-asset string, which is unindexed and ~4x slower).
 */
export function buildMarketQuery(pairId: string, perMarket: number): string {
  return `query Market {
  trades(first: ${perMarket}, orderBy: notional, orderDirection: desc, where: { isOpen: true, pair: "${pairId}" }) {${TRADE_FIELDS}
  }
}`;
}

export function parseMarketResponse(json: unknown): OstiumRawTrade[] {
  const body = json as {
    data?: { trades?: OstiumRawTrade[] };
    errors?: unknown;
  };
  if (body.errors) {
    throw new Error(`Ostium subgraph errors: ${JSON.stringify(body.errors)}`);
  }
  return body.data?.trades ?? [];
}

async function fetchOneMarket(
  pairId: string,
  perMarket: number,
  timeoutMs: number,
): Promise<OstiumRawTrade[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OSTIUM_SUBGRAPH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: buildMarketQuery(pairId, perMarket) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Ostium subgraph HTTP ${res.status} for pair ${pairId}`);
    }
    return parseMarketResponse(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the top `perMarket` open trades for each pair, fanned out across small
 * concurrent requests. A single market failing is logged and skipped — the rest
 * still return (graceful partial result).
 */
export async function fetchOstiumTopTradesByMarket(
  pairIds: string[],
  perMarket: number,
  opts: { concurrency?: number; timeoutMs?: number } = {},
): Promise<OstiumRawTrade[]> {
  const concurrency = opts.concurrency ?? 8;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const out: OstiumRawTrade[] = [];
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, pairIds.length) },
    async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        const pairId = pairIds[index];
        if (pairId === undefined) return;
        try {
          const trades = await fetchOneMarket(pairId, perMarket, timeoutMs);
          out.push(...trades);
        } catch (err) {
          console.warn(`[whales] Ostium market ${pairId} fetch failed:`, err);
        }
      }
    },
  );

  await Promise.all(workers);
  return out;
}
