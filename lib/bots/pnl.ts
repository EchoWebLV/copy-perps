// lib/bots/pnl.ts
//
// Pure PnL math — no server-only imports, safe to use from client
// components that want to recompute live PnL from a WS mark stream.
// The matching realized-PnL function lives here too so client and
// server agree on the formula.

import { applyExitSlippage, roundTripFeesUsd } from "./fees";

export interface PaperPnlArgs {
  side: "long" | "short";
  leverage: number;
  entryMark: number; // already includes entry slippage (resolver writes the fill)
  exitMark: number; // already includes exit slippage (resolver writes the fill)
  stakeUsd: number;
}

/**
 * Realized paper PnL in USD at exit, net of round-trip taker fees.
 * Pass the *stake* (margin) not notional — notional is computed inside
 * as stake × leverage so high-leverage bots earn proportionally bigger
 * absolute paper PnL per same price move, which is what the leaderboard
 * ranking needs for cross-bot comparability.
 *
 * Both entryMark and exitMark must already include their respective
 * slippage; the resolver writes the slipped fill prices. Fees are deducted
 * here so a single source of truth handles them.
 *
 * Sign convention: positive = profit.
 */
export function computePaperPnlUsd(args: PaperPnlArgs): number {
  const { side, leverage, entryMark, exitMark, stakeUsd } = args;
  const moveFrac = (exitMark - entryMark) / entryMark;
  const directional = side === "long" ? moveFrac : -moveFrac;
  const gross = stakeUsd * leverage * directional;
  const fees = roundTripFeesUsd(stakeUsd, leverage);
  return gross - fees;
}

export interface LivePaperPnlArgs {
  side: "long" | "short";
  leverage: number;
  entryMark: number; // already-slipped entry fill
  currentMark: number; // mid; we apply hypothetical exit slippage here
  asset: string;
  stakeUsd: number;
}

/**
 * Unrealized paper PnL as a fraction of stake — "what would I net if I
 * closed right now". Applies hypothetical exit slippage + the full
 * round-trip fee, so the displayed number matches what realization
 * would actually pay out. Honest by construction.
 */
export function computeLivePaperPnlPct(args: LivePaperPnlArgs): number {
  const { side, leverage, entryMark, currentMark, asset, stakeUsd } = args;
  if (stakeUsd <= 0) return 0;
  const exitFill = applyExitSlippage(currentMark, side, asset);
  const moveFrac = (exitFill - entryMark) / entryMark;
  const directional = side === "long" ? moveFrac : -moveFrac;
  const grossUsd = stakeUsd * leverage * directional;
  const feeUsd = roundTripFeesUsd(stakeUsd, leverage);
  return (grossUsd - feeUsd) / stakeUsd;
}
