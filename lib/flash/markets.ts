export const SUPPORTED_FLASH_MARKETS = ["BTC", "ETH", "SOL"] as const;

export type FlashMarketSymbol = (typeof SUPPORTED_FLASH_MARKETS)[number];

export function isFlashCopyableMarket(
  value: unknown,
): value is FlashMarketSymbol {
  return (
    typeof value === "string" &&
    (SUPPORTED_FLASH_MARKETS as readonly string[]).includes(
      value.trim().toUpperCase(),
    )
  );
}
