// lib/autopilot/shell.ts
//
// The deterministic risk shell. THE rule of Phase 3c: the brain may pick
// direction and conviction; this shell — pure code, no model — decides
// whether a trade is allowed at all and sets every money parameter
// (stake, leverage, mode, stops, hold) from the tier. The brain's
// conviction is journaled, never sized on.
//
// Budget semantics (locked):
//   lossBudgetRemaining = budgetUsd + min(realizedPnlUsd, 0)
// Losses eat the budget; profits do NOT extend the deployable budget.
// The session ends 'exhausted' when the loss budget hits zero and ends
// 'target' when realized PnL reaches +100% of budget (bankable win).

import type { FlashTradeMode } from "@/lib/flash/markets";
import type { BrainDecision } from "./brain";
import { computeStake, getTier, type TierName } from "./tiers";

// Tilt guard ported from the bot kit (lib/bots/paper.ts isInLossCooldown):
// N consecutive losses with the newest close inside the window pauses
// entries. The window anchors to the latest close, not "now minus window".
export const TILT_LOSS_STREAK = 2;
export const TILT_WINDOW_MS = 5 * 60 * 1000;

export interface ShellSessionState {
  budgetUsd: number;
  realizedPnlUsd: number;
  tier: TierName;
}

export interface RecentClose {
  /** Realized PnL (proceeds - stake). Unknown proceeds count as -stake. */
  pnlUsd: number;
  closedAt: Date;
}

export type SessionPhase = "active" | "exhausted" | "target";

export function lossBudgetRemaining(session: ShellSessionState): number {
  return session.budgetUsd + Math.min(session.realizedPnlUsd, 0);
}

export function sessionPhase(session: ShellSessionState): SessionPhase {
  if (session.realizedPnlUsd >= session.budgetUsd) return "target";
  if (lossBudgetRemaining(session) <= 0) return "exhausted";
  return "active";
}

/** recentCloses must be newest-first. */
export function isTiltCooldown(
  recentCloses: RecentClose[],
  now: Date,
): boolean {
  if (recentCloses.length < TILT_LOSS_STREAK) return false;
  const newest = recentCloses.slice(0, TILT_LOSS_STREAK);
  if (!newest.every((c) => c.pnlUsd < 0)) return false;
  const ageMs = now.getTime() - newest[0].closedAt.getTime();
  return ageMs <= TILT_WINDOW_MS;
}

export type ShellVerdict =
  | {
      allow: true;
      stakeUsdc: number;
      leverage: number;
      mode: FlashTradeMode;
      slRoiPct: number;
      tpRoiPct: number;
      maxHoldMin: number;
    }
  | { allow: false; reason: string };

export function evaluateShell(input: {
  session: ShellSessionState;
  openCount: number;
  /** Newest-first realized results, for the tilt guard. */
  recentCloses: RecentClose[];
  decision: BrainDecision;
  now: Date;
}): ShellVerdict {
  const tier = getTier(input.session.tier);

  const phase = sessionPhase(input.session);
  if (phase !== "active") {
    return { allow: false, reason: `session ${phase}` };
  }
  if (input.openCount >= tier.maxConcurrent) {
    return { allow: false, reason: "max concurrent positions reached" };
  }
  if (isTiltCooldown(input.recentCloses, input.now)) {
    return { allow: false, reason: "tilt cooldown (2 fast losses)" };
  }

  const remaining = lossBudgetRemaining(input.session);
  if (remaining < 1) {
    return { allow: false, reason: "remaining budget below $1" };
  }
  const stakeUsdc = computeStake(tier.name, remaining);
  if (stakeUsdc == null) {
    return { allow: false, reason: "remaining budget below minimum stake" };
  }
  if (stakeUsdc > remaining) {
    return { allow: false, reason: "stake exceeds remaining budget" };
  }

  return {
    allow: true,
    stakeUsdc,
    leverage: Math.min(tier.leverage, tier.maxLeverage),
    mode: tier.mode,
    slRoiPct: tier.slRoiPct,
    tpRoiPct: tier.tpRoiPct,
    maxHoldMin: tier.maxHoldMin,
  };
}
