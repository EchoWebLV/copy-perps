export const FLASH_POOL_NAMES = [
  "Crypto.1",
  "Community.1",
  "Community.2",
  "Equity.1",
  "Governance.1",
  "Ore.1",
  "Trump.1",
  "Virtual.1",
] as const;

export type FlashPoolName = (typeof FLASH_POOL_NAMES)[number];
export type FlashTradeMode = "standard" | "degen";
export type FlashMarketCategory =
  | "crypto"
  | "community"
  | "governance"
  | "commodity"
  | "fx"
  | "equity";

export interface FlashMarketDefinition {
  symbol: string;
  displayName: string;
  poolName: FlashPoolName;
  category: FlashMarketCategory;
  maxLeverage: number;
  standardMaxLeverage: number;
  degenMinLeverage: number;
  isVirtual: boolean;
}

export const FLASH_MARKETS = [
  { symbol: "BTC", displayName: "Bitcoin", poolName: "Crypto.1", category: "crypto", maxLeverage: 500, standardMaxLeverage: 100, degenMinLeverage: 125, isVirtual: false },
  { symbol: "ETH", displayName: "Ethereum", poolName: "Crypto.1", category: "crypto", maxLeverage: 500, standardMaxLeverage: 100, degenMinLeverage: 125, isVirtual: false },
  { symbol: "SOL", displayName: "Solana", poolName: "Crypto.1", category: "crypto", maxLeverage: 500, standardMaxLeverage: 100, degenMinLeverage: 125, isVirtual: false },
  { symbol: "ZEC", displayName: "Zcash", poolName: "Crypto.1", category: "crypto", maxLeverage: 10, standardMaxLeverage: 10, degenMinLeverage: 1, isVirtual: false },
  { symbol: "BNB", displayName: "BNB", poolName: "Crypto.1", category: "crypto", maxLeverage: 50, standardMaxLeverage: 50, degenMinLeverage: 1, isVirtual: true },
  { symbol: "BONK", displayName: "Bonk", poolName: "Community.1", category: "community", maxLeverage: 25, standardMaxLeverage: 25, degenMinLeverage: 1, isVirtual: false },
  { symbol: "PENGU", displayName: "Pudgy Penguins", poolName: "Community.1", category: "community", maxLeverage: 25, standardMaxLeverage: 25, degenMinLeverage: 1, isVirtual: false },
  { symbol: "PUMP", displayName: "Pump", poolName: "Community.1", category: "community", maxLeverage: 25, standardMaxLeverage: 25, degenMinLeverage: 1, isVirtual: false },
  { symbol: "WIF", displayName: "Dogwifhat", poolName: "Community.2", category: "community", maxLeverage: 25, standardMaxLeverage: 25, degenMinLeverage: 1, isVirtual: false },
  { symbol: "FARTCOIN", displayName: "Fartcoin", poolName: "Trump.1", category: "community", maxLeverage: 25, standardMaxLeverage: 25, degenMinLeverage: 1, isVirtual: false },
  { symbol: "ORE", displayName: "Ore", poolName: "Ore.1", category: "community", maxLeverage: 5, standardMaxLeverage: 5, degenMinLeverage: 1, isVirtual: false },
  { symbol: "JUP", displayName: "Jupiter", poolName: "Governance.1", category: "governance", maxLeverage: 50, standardMaxLeverage: 50, degenMinLeverage: 1, isVirtual: false },
  { symbol: "PYTH", displayName: "Pyth", poolName: "Governance.1", category: "governance", maxLeverage: 50, standardMaxLeverage: 50, degenMinLeverage: 1, isVirtual: true },
  { symbol: "JTO", displayName: "Jito", poolName: "Governance.1", category: "governance", maxLeverage: 10, standardMaxLeverage: 10, degenMinLeverage: 1, isVirtual: false },
  { symbol: "KMNO", displayName: "Kamino", poolName: "Governance.1", category: "governance", maxLeverage: 50, standardMaxLeverage: 50, degenMinLeverage: 1, isVirtual: true },
  { symbol: "HYPE", displayName: "Hyperliquid", poolName: "Governance.1", category: "governance", maxLeverage: 20, standardMaxLeverage: 20, degenMinLeverage: 1, isVirtual: false },
  { symbol: "MEGA", displayName: "Mega", poolName: "Governance.1", category: "governance", maxLeverage: 5, standardMaxLeverage: 5, degenMinLeverage: 1, isVirtual: true },
  { symbol: "XAU", displayName: "Gold", poolName: "Virtual.1", category: "commodity", maxLeverage: 100, standardMaxLeverage: 100, degenMinLeverage: 1, isVirtual: true },
  { symbol: "XAG", displayName: "Silver", poolName: "Virtual.1", category: "commodity", maxLeverage: 100, standardMaxLeverage: 100, degenMinLeverage: 1, isVirtual: true },
  { symbol: "EUR", displayName: "Euro", poolName: "Virtual.1", category: "fx", maxLeverage: 500, standardMaxLeverage: 100, degenMinLeverage: 125, isVirtual: true },
  { symbol: "GBP", displayName: "Pound", poolName: "Virtual.1", category: "fx", maxLeverage: 500, standardMaxLeverage: 100, degenMinLeverage: 125, isVirtual: true },
  { symbol: "CRUDEOIL", displayName: "Oil", poolName: "Virtual.1", category: "commodity", maxLeverage: 5, standardMaxLeverage: 5, degenMinLeverage: 1, isVirtual: true },
  { symbol: "USDJPY", displayName: "USD/JPY", poolName: "Virtual.1", category: "fx", maxLeverage: 500, standardMaxLeverage: 100, degenMinLeverage: 125, isVirtual: true },
  { symbol: "USDCNH", displayName: "USD/CNH", poolName: "Virtual.1", category: "fx", maxLeverage: 500, standardMaxLeverage: 100, degenMinLeverage: 125, isVirtual: true },
  { symbol: "NATGAS", displayName: "Nat Gas", poolName: "Virtual.1", category: "commodity", maxLeverage: 10, standardMaxLeverage: 10, degenMinLeverage: 1, isVirtual: true },
  { symbol: "SPY", displayName: "S&P 500", poolName: "Equity.1", category: "equity", maxLeverage: 20, standardMaxLeverage: 20, degenMinLeverage: 1, isVirtual: false },
  { symbol: "NVDA", displayName: "NVIDIA", poolName: "Equity.1", category: "equity", maxLeverage: 20, standardMaxLeverage: 20, degenMinLeverage: 1, isVirtual: true },
  { symbol: "TSLA", displayName: "Tesla", poolName: "Equity.1", category: "equity", maxLeverage: 20, standardMaxLeverage: 20, degenMinLeverage: 1, isVirtual: true },
  { symbol: "AAPL", displayName: "Apple", poolName: "Equity.1", category: "equity", maxLeverage: 20, standardMaxLeverage: 20, degenMinLeverage: 1, isVirtual: true },
  { symbol: "AMD", displayName: "AMD", poolName: "Equity.1", category: "equity", maxLeverage: 20, standardMaxLeverage: 20, degenMinLeverage: 1, isVirtual: true },
  { symbol: "AMZN", displayName: "Amazon", poolName: "Equity.1", category: "equity", maxLeverage: 20, standardMaxLeverage: 20, degenMinLeverage: 1, isVirtual: true },
] as const satisfies readonly FlashMarketDefinition[];

export type FlashMarketSymbol = (typeof FLASH_MARKETS)[number]["symbol"];

export const SUPPORTED_FLASH_MARKETS = FLASH_MARKETS.map(
  (market) => market.symbol,
) as FlashMarketSymbol[];

const FLASH_MARKET_BY_NORMALIZED_SYMBOL = new Map(
  FLASH_MARKETS.map((market) => [market.symbol.toUpperCase(), market]),
);

// Source venues (Hyperliquid, Pacifica) sometimes name a market differently
// than Flash even though it's the same tradeable underlying. Map those names
// onto the Flash market we actually execute, so the whale position becomes
// copyable instead of being silently dropped by the copyable-market filter.
const FLASH_MARKET_ALIASES: Record<string, FlashMarketSymbol> = {
  SP500: "SPY", // Hyperliquid S&P 500 index
  PAXG: "XAU", // Paxos Gold -> gold
  KBONK: "BONK", // Hyperliquid 1000x BONK price quote
};

export function normalizeFlashMarket(value: unknown): FlashMarketSymbol | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toUpperCase();
  return (
    FLASH_MARKET_BY_NORMALIZED_SYMBOL.get(key)?.symbol ??
    FLASH_MARKET_ALIASES[key] ??
    null
  );
}

export function flashMarketConfigForSymbol(
  value: unknown,
): FlashMarketDefinition | null {
  const market = normalizeFlashMarket(value);
  return market === null
    ? null
    : FLASH_MARKET_BY_NORMALIZED_SYMBOL.get(market) ?? null;
}

export function flashPoolNameForMarket(value: unknown): FlashPoolName | null {
  return flashMarketConfigForSymbol(value)?.poolName ?? null;
}

export function isFlashCopyableMarket(
  value: unknown,
): value is FlashMarketSymbol {
  return normalizeFlashMarket(value) !== null;
}

export function maxFlashLeverageForMarket(value: unknown): number | null {
  return flashMarketConfigForSymbol(value)?.maxLeverage ?? null;
}

export function maxFlashDegenLeverageForMarket(value: unknown): number | null {
  return flashMarketConfigForSymbol(value)?.maxLeverage ?? null;
}

export function flashLeverageBoundsForMarket(
  value: unknown,
  mode: FlashTradeMode,
): { min: number; max: number } | null {
  const config = flashMarketConfigForSymbol(value);
  if (!config) return null;
  if (mode === "degen") {
    return {
      min: config.degenMinLeverage,
      max: config.maxLeverage,
    };
  }
  return { min: 1, max: config.standardMaxLeverage };
}

export function flashTradeModeForLeverage(
  value: unknown,
  leverage: unknown,
): FlashTradeMode | null {
  const config = flashMarketConfigForSymbol(value);
  const parsedLeverage = Number(leverage);
  if (!config || !Number.isFinite(parsedLeverage) || parsedLeverage < 1) {
    return null;
  }
  if (parsedLeverage <= config.standardMaxLeverage) return "standard";
  return parsedLeverage >= config.degenMinLeverage &&
    parsedLeverage <= config.maxLeverage
    ? "degen"
    : null;
}

export function flashLeverageOptionsForMarket(
  value: unknown,
  mode: FlashTradeMode,
): number[] {
  const bounds = flashLeverageBoundsForMarket(value, mode);
  if (!bounds) return [];
  const baseOptions = mode === "degen" ? [125, 250, 500] : [20, 50, 100];
  const options = baseOptions.filter(
    (option) => option >= bounds.min && option <= bounds.max,
  );
  if (!options.includes(bounds.max)) options.push(bounds.max);
  return [...new Set(options)].sort((a, b) => a - b);
}
