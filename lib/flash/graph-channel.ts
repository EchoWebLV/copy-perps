/**
 * Pure money-channel geometry for the Scalp graph. No React, no RPC.
 *
 * The graph lives in money-space: Y = position value in USD. Every level is a
 * horizontal line at a value, and value maps linearly from ROI on the staked
 * collateral: valueAtRoi(stake, roi) = stake * (1 + roi / 100).
 *   entry → roi   0% → stake
 *   TP    → roi +100% → 2 * stake
 *   SL    → roi  -50% → 0.5 * stake
 *   liq   → roi -100% → 0
 */

export type TriggerKind = "tp" | "sl";

export interface TriggerLevelInput {
  kind: TriggerKind;
  roiPct: number;
}

export interface ChannelInput {
  /** User stake (posted collateral intent) in USD — the entry baseline value. */
  stakeUsd: number;
  /** Current live position value in USD (stake +/- P/L). */
  valueUsd: number;
  /** Configured take-profit, or null/undefined when off (default). */
  tp?: TriggerLevelInput | null;
  /** Configured stop-loss, or null/undefined when off (default). */
  sl?: TriggerLevelInput | null;
}

export type ChannelLineId = "tp" | "entry" | "sl" | "liq";

export interface ChannelLine {
  id: ChannelLineId;
  valueUsd: number;
  roiPct: number;
}

export interface Channel {
  /** Bottom of the Y domain. Always 0 — the liquidation floor. */
  minValue: number;
  /** Top of the Y domain — headroom above the TP ceiling / live tip. */
  maxValue: number;
  /** Horizontal reference lines, top-to-bottom by value. Always includes
   * entry + liq; tp/sl appear only when configured. */
  lines: ChannelLine[];
  /** Map a USD value to an SVG y coordinate (clamped into the padded area). */
  valueToY: (value: number, height: number, pad: number) => number;
}

export const LIQ_ROI_PCT = -100;

/** Position value at a given ROI percent on the staked collateral. */
export function valueAtRoi(stakeUsd: number, roiPct: number): number {
  return stakeUsd * (1 + roiPct / 100);
}

const HEADROOM = 1.15; // 15% breathing room above the highest line/tip.

export function buildChannel(input: ChannelInput): Channel {
  const stake = Number.isFinite(input.stakeUsd) ? Math.max(0, input.stakeUsd) : 0;
  const value = Number.isFinite(input.valueUsd) ? Math.max(0, input.valueUsd) : 0;

  const lines: ChannelLine[] = [
    { id: "entry", valueUsd: stake, roiPct: 0 },
    { id: "liq", valueUsd: 0, roiPct: LIQ_ROI_PCT },
  ];
  if (input.tp && Number.isFinite(input.tp.roiPct)) {
    lines.push({
      id: "tp",
      valueUsd: valueAtRoi(stake, input.tp.roiPct),
      roiPct: input.tp.roiPct,
    });
  }
  if (input.sl && Number.isFinite(input.sl.roiPct)) {
    lines.push({
      id: "sl",
      valueUsd: valueAtRoi(stake, input.sl.roiPct),
      roiPct: input.sl.roiPct,
    });
  }
  lines.sort((a, b) => b.valueUsd - a.valueUsd);

  const minValue = 0; // liquidation floor anchors the bottom.
  const topCandidate = Math.max(
    stake,
    value,
    ...lines.map((l) => l.valueUsd),
  );
  const maxValue = Math.max(topCandidate * HEADROOM, stake * 2, 1);

  const valueToY = (v: number, height: number, pad: number): number => {
    const span = maxValue - minValue || 1;
    const t = Math.min(1, Math.max(0, (v - minValue) / span));
    return height - pad - t * (height - 2 * pad);
  };

  return { minValue, maxValue, lines, valueToY };
}
