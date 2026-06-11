// lib/autopilot/brain.ts
//
// The Autopilot brain: the recovered Blitz 15m momentum/breakout strategy
// (commit dfac7ae) ported to a pure, self-contained function. The brain
// ONLY picks direction + conviction; stake/leverage/stops belong to the
// shell + tier (see shell.ts). No ExternalSignals, no DB, no LLM — v1 is
// deterministic on (candles, mark).
//
// Blitz numbers kept verbatim: 0.6% breakout past the prior range,
// >=1.4x average volume confirm, exit on a 1% favorable move; max hold
// comes from the tier (Blitz's 90 min == cruise).

import type { Candle } from "@/lib/data/candles";

export const AUTOPILOT_TIMEFRAME = "15m" as const;
export const AUTOPILOT_CANDLE_COUNT = 20;

const MIN_CANDLES = 12; // Blitz candleCount
const BREAKOUT_PCT = 0.006; // 0.6% clear of the prior range
const VOLUME_MULTIPLIER = 1.4; // >=1.4x average volume
const EXIT_FAVORABLE_PCT = 0.01; // bank a 1% favorable move
const CONVICTION_FLOOR = 0.3;

export interface BrainDecision {
  side: "long" | "short";
  /** Clamped [0.3, 1]. Journaled only — NEVER used for sizing (shell rule). */
  conviction: number;
  /** Human-readable reason for the decision log. */
  reason: string;
}

export function decide(input: {
  candles: Candle[];
  markPrice: number;
}): BrainDecision | null {
  const { candles, markPrice } = input;
  if (!Number.isFinite(markPrice) || markPrice <= 0) return null;
  if (candles.length < MIN_CANDLES) return null;

  const last = candles[candles.length - 1];
  const prior = candles.slice(0, -1);
  const priorHigh = Math.max(...prior.map((c) => c.high));
  const priorLow = Math.min(...prior.map((c) => c.low));
  const avgVolume =
    prior.reduce((sum, c) => sum + c.volume, 0) / prior.length;
  if (
    !Number.isFinite(priorHigh) ||
    !Number.isFinite(priorLow) ||
    priorHigh <= 0 ||
    priorLow <= 0
  ) {
    return null;
  }

  // Breakout: the last close clears the prior N-bar range by >= 0.6%.
  let side: "long" | "short" | null = null;
  let breakoutExcess = 0;
  const upExcess = last.close / priorHigh - 1;
  const downExcess = 1 - last.close / priorLow;
  if (upExcess >= BREAKOUT_PCT) {
    side = "long";
    breakoutExcess = upExcess;
  } else if (downExcess >= BREAKOUT_PCT) {
    side = "short";
    breakoutExcess = downExcess;
  }
  if (!side) return null;

  // Volume confirm: breakout candle runs >= 1.4x the prior average.
  if (!(avgVolume > 0) || last.volume < VOLUME_MULTIPLIER * avgVolume) {
    return null;
  }

  // Trend filter: the net move across the window must agree with the
  // breakout direction — no longing a lower-high bounce in a downtrend.
  const first = candles[0].close;
  if (!Number.isFinite(first) || first <= 0) return null;
  const netMove = (last.close - first) / first;
  if (side === "long" && netMove <= 0) return null;
  if (side === "short" && netMove >= 0) return null;

  // Conviction: floor 0.3; scales with how far past the thresholds the
  // breakout and volume spike run. A 2x-threshold breakout on 2x-threshold
  // volume maps to 1.0.
  const breakoutScore = Math.min(1, breakoutExcess / (BREAKOUT_PCT * 2));
  const volumeScore = Math.min(
    1,
    last.volume / (VOLUME_MULTIPLIER * avgVolume * 2),
  );
  const conviction = Math.min(
    1,
    Math.max(
      CONVICTION_FLOOR,
      CONVICTION_FLOOR + 0.7 * (0.6 * breakoutScore + 0.4 * volumeScore),
    ),
  );

  return {
    side,
    conviction,
    reason: `15m breakout ${(breakoutExcess * 100).toFixed(2)}% on ${(
      last.volume / avgVolume
    ).toFixed(1)}x volume`,
  };
}

/**
 * Soft exit: bank a 1% favorable move, or force out at the tier's max
 * hold. The downside is deliberately NOT handled here — the on-chain SL
 * trigger owns it (and survives process restarts; this function doesn't).
 */
export function shouldExit(input: {
  entryPrice: number | null;
  side: "long" | "short";
  markPrice: number | null;
  ageMin: number;
  maxHoldMin: number;
}): boolean {
  if (input.ageMin >= input.maxHoldMin) return true;
  if (input.entryPrice == null || input.markPrice == null) return false;
  if (!Number.isFinite(input.entryPrice) || input.entryPrice <= 0) {
    return false;
  }
  const moveFrac = (input.markPrice - input.entryPrice) / input.entryPrice;
  const favorable = input.side === "long" ? moveFrac : -moveFrac;
  return favorable >= EXIT_FAVORABLE_PCT;
}
