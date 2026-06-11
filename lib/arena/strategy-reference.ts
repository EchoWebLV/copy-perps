// lib/arena/strategy-reference.ts
//
// TS reference of the on-chain "ring momentum v1" strategy (arena-program).
// BigInt-only math — this file is the parity oracle for the Rust port; the two
// implementations must agree on every fixture in fixtures/arena/strategy-cases.json.
// Change them together, never independently.
//
// Adapted from lib/autopilot/brain.ts: the 1.4x-volume confirm becomes an
// activity confirm on per-bucket path length (Σ|Δprice|), because the oracle
// feed carries prices, not volume.

export interface StrategyCandle {
  o: bigint;
  h: bigint;
  l: bigint;
  c: bigint;
  pathLen: bigint;
}

export interface StrategyParams {
  breakoutBps: number;
  activityMultBps: number;
  trendFilter: boolean;
}

export const MIN_CANDLES = 12;
const BPS = 10_000n;

export function decideRingMomentum(
  candles: StrategyCandle[],
  params: StrategyParams,
): "long" | "short" | null {
  // Domain: 0 <= breakoutBps < 10_000. At >= 10_000 the short comparison
  // (priorLow * (BPS - bo)) goes negative — fine for BigInt, an underflow
  // panic for Rust u64 — so both implementations fail closed here instead.
  if (params.breakoutBps < 0 || params.breakoutBps >= 10_000) return null;
  if (candles.length < MIN_CANDLES) return null;
  const last = candles[candles.length - 1];
  if (last.c <= 0n) return null;
  const prior = candles.slice(0, -1);
  let priorHigh = 0n;
  let priorLow = (1n << 64n) - 1n;
  let pathSum = 0n;
  for (const k of prior) {
    if (k.h > priorHigh) priorHigh = k.h;
    if (k.l < priorLow) priorLow = k.l;
    pathSum += k.pathLen;
  }
  if (priorHigh <= 0n || priorLow <= 0n) return null;

  // Breakout: last close clears the prior range by >= breakoutBps
  // (integer cross-multiply — no division, mirrors the Rust port).
  const bo = BigInt(params.breakoutBps);
  let side: "long" | "short" | null = null;
  if (last.c * BPS >= priorHigh * (BPS + bo)) side = "long";
  else if (last.c * BPS <= priorLow * (BPS - bo)) side = "short";
  if (!side) return null;

  // Activity confirm: last pathLen >= multiplier x prior average, cross-multiplied.
  if (pathSum <= 0n) return null;
  const mult = BigInt(params.activityMultBps);
  if (last.pathLen * BigInt(prior.length) * BPS < mult * pathSum) return null;

  // Trend filter, kept for brain.ts fidelity. Note: with h >= c invariants a
  // full-range breakout always agrees with the net move, so this gate is
  // belt-and-braces — it only bites on malformed candles.
  if (params.trendFilter) {
    const first = candles[0].c;
    if (first <= 0n) return null;
    if (side === "long" && last.c <= first) return null;
    if (side === "short" && last.c >= first) return null;
  }
  return side;
}
