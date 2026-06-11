// lib/autopilot/tiers.ts
//
// Pure tier definitions for Scalp Autopilot. The tier — never the brain —
// decides every money parameter: stake, leverage, mode, stops, hold time.
// Numbers are the Phase 3c locked values; clamps mirror the Flash bounds
// (lib/flash/markets.ts: BTC/ETH/SOL standardMax 100x, degen 125..500x;
// lib/flash/triggers.ts: TP 1..10000, SL -95..-1).

import type { FlashTradeMode } from "@/lib/flash/markets";

// Mirrors FLASH_MIN_NOTIONAL_USD in lib/flash/perps.ts. Re-declared so this
// module stays pure — importing perps.ts drags the whole flash-sdk in.
const FLASH_MIN_NOTIONAL_USD = 10;

export type TierName = "cruise" | "sweat" | "degen";

export interface Tier {
  name: TierName;
  /** Flash trade mode every trade in this tier uses. */
  mode: FlashTradeMode;
  /** Fixed leverage for every trade — the brain never picks it. */
  leverage: number;
  /** Sanity ceiling; anything above is a bug, clamped by the shell. */
  maxLeverage: number;
  /** Stake as a fraction of the REMAINING loss budget. */
  stakePctOfBudget: number;
  /** Absolute stake floor ($1 = the /api/flash/perp route minimum). */
  stakeUsdMin: number;
  /** Absolute stake cap; null = only the pct rule applies. */
  stakeUsdMax: number | null;
  maxConcurrent: number;
  /** Mandatory stop-loss trigger, ROI % on collateral. */
  slRoiPct: number;
  /** Take-profit trigger, ROI % on collateral. */
  tpRoiPct: number;
  /** Engine force-exits any position older than this. */
  maxHoldMin: number;
}

export const TIERS: Record<TierName, Tier> = {
  cruise: {
    name: "cruise",
    mode: "standard",
    leverage: 50,
    maxLeverage: 100,
    stakePctOfBudget: 0.1,
    stakeUsdMin: 1,
    stakeUsdMax: null,
    maxConcurrent: 2,
    slRoiPct: -50,
    tpRoiPct: 100,
    maxHoldMin: 90,
  },
  sweat: {
    name: "sweat",
    mode: "degen",
    leverage: 150,
    maxLeverage: 250,
    stakePctOfBudget: 0.05,
    stakeUsdMin: 1,
    stakeUsdMax: null,
    maxConcurrent: 1,
    slRoiPct: -50,
    tpRoiPct: 100,
    maxHoldMin: 45,
  },
  degen: {
    name: "degen",
    mode: "degen",
    leverage: 500,
    maxLeverage: 500,
    stakePctOfBudget: 0.1,
    stakeUsdMin: 1,
    stakeUsdMax: 10,
    maxConcurrent: 1,
    slRoiPct: -50,
    tpRoiPct: 150,
    maxHoldMin: 15,
  },
};

export function isTierName(value: unknown): value is TierName {
  return value === "cruise" || value === "sweat" || value === "degen";
}

export function getTier(name: TierName): Tier {
  return TIERS[name];
}

/**
 * Deterministic stake for the next trade given what's left of the loss
 * budget. Returns null when the remaining budget can no longer fund a
 * valid trade ($1 stake floor, $10 Flash min notional, never more than
 * what remains). Rounded down to cents.
 */
export function computeStake(
  tierName: TierName,
  remainingBudgetUsd: number,
): number | null {
  const tier = TIERS[tierName];
  if (
    !Number.isFinite(remainingBudgetUsd) ||
    remainingBudgetUsd < tier.stakeUsdMin
  ) {
    return null;
  }
  let stake = remainingBudgetUsd * tier.stakePctOfBudget;
  stake = Math.max(stake, tier.stakeUsdMin);
  if (tier.stakeUsdMax != null) stake = Math.min(stake, tier.stakeUsdMax);
  stake = Math.min(stake, remainingBudgetUsd);
  stake = Math.floor(stake * 100) / 100;
  if (stake < tier.stakeUsdMin) return null;
  if (stake * tier.leverage < FLASH_MIN_NOTIONAL_USD) return null;
  return stake;
}
