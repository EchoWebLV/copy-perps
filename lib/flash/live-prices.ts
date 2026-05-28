export const FLASH_LIVE_PRICE_FEEDS = {
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
} as const;

export type FlashLivePriceSymbol = keyof typeof FLASH_LIVE_PRICE_FEEDS;

export interface FlashLiveMark {
  priceUsd: number;
  publishTimeMs: number;
}

const FLASH_LIVE_SYMBOL_BY_FEED_ID = new Map(
  Object.entries(FLASH_LIVE_PRICE_FEEDS).map(([symbol, feedId]) => [
    normalizeFeedId(feedId),
    symbol as FlashLivePriceSymbol,
  ]),
);

function normalizeFeedId(value: string): string {
  return value.trim().toLowerCase().replace(/^0x/, "");
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pythPriceToUsd(price: unknown, exponent: unknown): number | null {
  const priceNumber = finiteNumber(price);
  const exponentNumber = finiteNumber(exponent);
  if (priceNumber == null || exponentNumber == null) return null;
  const priceUsd = priceNumber * 10 ** exponentNumber;
  return Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : null;
}

export function buildPythHermesStreamUrl(
  baseUrl = "https://hermes.pyth.network",
): string {
  const url = new URL("/v2/updates/price/stream", baseUrl);
  for (const feedId of Object.values(FLASH_LIVE_PRICE_FEEDS)) {
    url.searchParams.append("ids[]", feedId);
  }
  return url.toString();
}

export function parsePythPriceUpdate(
  data: string,
): Partial<Record<FlashLivePriceSymbol, FlashLiveMark>> {
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return {};
  }

  if (
    payload == null ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { parsed?: unknown }).parsed)
  ) {
    return {};
  }

  const marks: Partial<Record<FlashLivePriceSymbol, FlashLiveMark>> = {};
  for (const parsed of (payload as { parsed: unknown[] }).parsed) {
    if (parsed == null || typeof parsed !== "object") continue;
    const row = parsed as {
      id?: unknown;
      price?: { price?: unknown; expo?: unknown; publish_time?: unknown };
    };
    if (typeof row.id !== "string") continue;
    const symbol = FLASH_LIVE_SYMBOL_BY_FEED_ID.get(normalizeFeedId(row.id));
    if (!symbol) continue;
    const priceUsd = pythPriceToUsd(row.price?.price, row.price?.expo);
    const publishTime = finiteNumber(row.price?.publish_time);
    if (priceUsd == null || publishTime == null) continue;
    marks[symbol] = {
      priceUsd,
      publishTimeMs: publishTime * 1000,
    };
  }
  return marks;
}
