// lib/bots/leverage.ts
//
// Maps a strategy's conviction score onto an integer leverage in
// [min, max]. When min/max aren't configured the strategy falls back to
// a fixed leverage, which preserves the legacy single-knob behavior.
//
// Why dynamic: friction (slippage + taker fees) scales with leverage, so
// charging the highest leverage on every entry is a tax on weak signals.
// Linear mapping by conviction means a marginal trigger (conviction 0.3)
// fires at the low end and a strong one (conviction 1.0) gets the full
// stack — best-case Sharpe for the round-trip cost we're paying.

export interface LeverageParams {
  minLeverage?: number;
  maxLeverage?: number;
  leverage: number;
}

export function leverageFromConviction(
  p: LeverageParams,
  conviction: number,
): number {
  const min = p.minLeverage;
  const max = p.maxLeverage;
  if (min == null || max == null) return p.leverage;
  const clamped = Math.min(1, Math.max(0, conviction));
  return Math.max(1, Math.round(min + clamped * (max - min)));
}
