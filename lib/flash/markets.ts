export const SUPPORTED_FLASH_MARKETS = ["BTC", "ETH", "SOL"] as const;

export type FlashMarketSymbol = (typeof SUPPORTED_FLASH_MARKETS)[number];

export const FLASH_MAX_LEVERAGE_BY_MARKET = {
  BTC: 100,
  ETH: 100,
  SOL: 100,
} satisfies Record<FlashMarketSymbol, number>;

function normalizeFlashMarket(value: unknown): FlashMarketSymbol | null {
  if (typeof value !== "string") return null;
  const market = value.trim().toUpperCase();
  return (SUPPORTED_FLASH_MARKETS as readonly string[]).includes(market)
    ? (market as FlashMarketSymbol)
    : null;
}

export function isFlashCopyableMarket(
  value: unknown,
): value is FlashMarketSymbol {
  return normalizeFlashMarket(value) !== null;
}

export function maxFlashLeverageForMarket(value: unknown): number | null {
  const market = normalizeFlashMarket(value);
  return market === null ? null : FLASH_MAX_LEVERAGE_BY_MARKET[market];
}
