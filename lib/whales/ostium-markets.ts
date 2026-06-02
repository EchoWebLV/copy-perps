import type { FlashMarketSymbol } from "@/lib/flash/markets";

/**
 * Ostium's public Ormi subgraph (Arbitrum mainnet). The API key is part of the
 * public URL — no auth header. Override via env if Ostium rotates it.
 */
export const OSTIUM_SUBGRAPH_URL =
  process.env.OSTIUM_SUBGRAPH_URL ??
  "https://api.subgraph.ormilabs.com/api/public/67a599d5-c8d2-4cc4-9c4d-2975a97bc5d8/subgraphs/ost-prod/live/gn";

/**
 * Authoritative Ostium pairId -> Flash symbol map. Enumerated live from the
 * subgraph `pairs` query on 2026-06-02. We store the *Flash* symbol as the
 * position market so isFlashCopyableMarket and card headlines work unchanged.
 * Only pairs that map to one of the 31 Flash markets are included (focused
 * scope); crypto majors are included because the Ostium wallets are distinct
 * from HL/Pacifica and add HYPE/BNB density.
 */
const OSTIUM_PAIR_TO_FLASH: Record<string, FlashMarketSymbol> = {
  // commodities
  "5": "XAU", // XAU/USD gold
  "8": "XAG", // XAG/USD silver
  "7": "CRUDEOIL", // CL/USD WTI crude
  // forex
  "2": "EUR", // EUR/USD
  "3": "GBP", // GBP/USD
  "4": "USDJPY", // USD/JPY
  // index
  "10": "SPY", // SPX/USD -> S&P 500
  // stocks
  "18": "NVDA",
  "20": "AMZN",
  "22": "TSLA",
  "23": "AAPL",
  "45": "AMD",
  // crypto majors (distinct wallets; HYPE/BNB density)
  "0": "BTC",
  "1": "ETH",
  "9": "SOL",
  "38": "BNB",
  "41": "HYPE",
};

export const OSTIUM_MAPPED_PAIR_IDS = Object.keys(OSTIUM_PAIR_TO_FLASH);

export function ostiumPairToFlashSymbol(
  pairId: string,
): FlashMarketSymbol | null {
  return OSTIUM_PAIR_TO_FLASH[pairId] ?? null;
}
