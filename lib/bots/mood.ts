// lib/bots/mood.ts
//
// Deterministic mood-badge state machine. Computed per bot every time
// buildBotSignals() runs. No LLM, no DB write — purely a function of
// current state. Order of precedence below matters: BUSTED > WOUNDED >
// ON_STREAK > LOADED > HUNTING > DORMANT.

import type { PaperPosition, BotConfig } from "./types";

export type MoodBadge =
  | "BUSTED"
  | "WOUNDED"
  | "ON_STREAK"
  | "LOADED"
  | "HUNTING"
  | "DORMANT";

export interface MoodInput {
  botStatus: BotConfig["status"] | "busted";
  balanceUsd: number;
  startingBalanceUsd: number;
  openPositions: PaperPosition[];
  recentClosedPnls: number[]; // last N closed paper_pnl_usd values, newest first
  /** Map from positionId → live PnL fraction on stake. Used to detect WOUNDED. */
  livePnlPctByPositionId?: Record<string, number>;
  /** Set true when a near-trade signal is forming for this bot. Drives HUNTING. */
  hasNearSignal?: boolean;
}

const WOUNDED_THRESHOLD = -0.25; // -25% on stake → WOUNDED
const STREAK_LENGTH = 3;

export function computeMoodBadge(input: MoodInput): MoodBadge {
  if (input.botStatus === "busted") return "BUSTED";

  if (input.openPositions.length > 0 && input.livePnlPctByPositionId) {
    const anyWounded = input.openPositions.some((p) => {
      const pct = input.livePnlPctByPositionId?.[p.id];
      return pct !== undefined && pct <= WOUNDED_THRESHOLD;
    });
    if (anyWounded) return "WOUNDED";
  }

  if (
    input.recentClosedPnls.length >= STREAK_LENGTH &&
    input.recentClosedPnls
      .slice(0, STREAK_LENGTH)
      .every((p) => p > 0)
  ) {
    return "ON_STREAK";
  }

  if (input.openPositions.length > 0) return "LOADED";

  if (input.hasNearSignal) return "HUNTING";

  return "DORMANT";
}
