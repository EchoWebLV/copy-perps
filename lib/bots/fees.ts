// lib/bots/fees.ts
//
// Per-trade cost model used by the paper simulator so PnL reflects what
// the bot would actually capture on a live Pacifica/HL execution. Two
// components:
//
// 1. Taker fee — 4 bps (0.04%) per side, applied to notional. Pacifica
//    publishes 4 bps taker; Hyperliquid is closer to 3 bps. We pick the
//    conservative side because every bot in this roster uses market
//    orders (no maker rebate).
//
// 2. Slippage — adverse fill on entry and exit. Calibrated per asset
//    based on observed top-of-book depth. Bots that trade thin assets
//    (HYPE, FARTCOIN) pay materially more than majors.
//
// At 20x leverage on SOL the round-trip drag is ~3.2% of stake; on a
// thin alt at 20x it's closer to 5%. That's the realism delta we want.

export const TAKER_FEE_BPS = 4;

const SLIPPAGE_BY_ASSET: Record<string, number> = {
  BTC: 3,
  ETH: 3,
  SOL: 4,
  BNB: 5,
  XRP: 5,
  AVAX: 6,
  LINK: 6,
  DOGE: 6,
  ADA: 6,
  HYPE: 8,
  JUP: 8,
  PEPE: 10,
  WIF: 10,
  FARTCOIN: 12,
};
const DEFAULT_SLIPPAGE_BPS = 10;

export function slippageBpsFor(asset: string): number {
  return SLIPPAGE_BY_ASSET[asset] ?? DEFAULT_SLIPPAGE_BPS;
}

/**
 * Adverse entry fill: longs pay the ask (above mid), shorts hit the bid
 * (below mid). Returns the price the bot actually got, which we store as
 * entry_mark from that point on.
 */
export function applyEntrySlippage(
  mid: number,
  side: "long" | "short",
  asset: string,
): number {
  const adjust = slippageBpsFor(asset) / 10_000;
  return side === "long" ? mid * (1 + adjust) : mid * (1 - adjust);
}

/**
 * Adverse exit fill: longs sell into the bid (below mid), shorts buy back
 * the ask (above mid). Both directions reduce realized PnL.
 */
export function applyExitSlippage(
  mid: number,
  side: "long" | "short",
  asset: string,
): number {
  const adjust = slippageBpsFor(asset) / 10_000;
  return side === "long" ? mid * (1 - adjust) : mid * (1 + adjust);
}

/**
 * Round-trip taker fees in USD. Applied at close — opening a paper
 * position doesn't immediately cost the bot, but the fee shows up at
 * realization just like a real perp settlement.
 */
export function roundTripFeesUsd(stakeUsd: number, leverage: number): number {
  const notional = stakeUsd * leverage;
  return notional * (TAKER_FEE_BPS / 10_000) * 2;
}

/**
 * One-side taker fee in USD. Used by the live-PnL display so an open
 * position already shows fee + exit-slippage drag (the user is seeing
 * "what would I get if I closed now").
 */
export function singleSideFeeUsd(stakeUsd: number, leverage: number): number {
  const notional = stakeUsd * leverage;
  return notional * (TAKER_FEE_BPS / 10_000);
}
