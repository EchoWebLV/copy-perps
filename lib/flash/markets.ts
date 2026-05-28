export const SUPPORTED_FLASH_MARKETS = ["BTC", "ETH", "SOL"] as const;

export type FlashMarketSymbol = (typeof SUPPORTED_FLASH_MARKETS)[number];

export const FLASH_MAX_LEVERAGE_BY_MARKET = {
  BTC: 100,
  ETH: 100,
  SOL: 100,
} satisfies Record<FlashMarketSymbol, number>;

export const FLASH_DEGEN_LEVERAGE_BY_MARKET = {
  BTC: { min: 125, max: 500 },
  ETH: { min: 125, max: 500 },
  SOL: { min: 125, max: 500 },
} satisfies Record<FlashMarketSymbol, { min: number; max: number }>;

export type FlashTradeMode = "standard" | "degen";

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

export function maxFlashDegenLeverageForMarket(value: unknown): number | null {
  const market = normalizeFlashMarket(value);
  return market === null ? null : FLASH_DEGEN_LEVERAGE_BY_MARKET[market].max;
}

export function flashLeverageBoundsForMarket(
  value: unknown,
  mode: FlashTradeMode,
): { min: number; max: number } | null {
  const market = normalizeFlashMarket(value);
  if (market === null) return null;
  if (mode === "degen") return FLASH_DEGEN_LEVERAGE_BY_MARKET[market];
  return { min: 1, max: FLASH_MAX_LEVERAGE_BY_MARKET[market] };
}
