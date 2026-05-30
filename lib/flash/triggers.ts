import type { TriggerKind } from "./graph-channel";
import type { FlashSide } from "./perps";

export type { TriggerKind };

/** An active on-chain trigger order surfaced to the client. */
export interface TriggerOrderView {
  kind: TriggerKind;
  /** 1-based slot ordinal within its kind array; passed back to cancel/edit. */
  orderId: number;
  triggerPriceUsd: number;
  /** Approximate ROI on collateral implied by the trigger price (display only). */
  roiPct: number;
}

export type TriggerValidation =
  | { ok: true; roiPct: number }
  | { ok: false; message: string };

// Take-profit must be in profit; stop-loss must sit strictly between entry
// (0%) and liquidation (-100%). Soft bounds clamp; hard bounds reject.
export const TP_MIN_ROI_PCT = 1;
export const TP_MAX_ROI_PCT = 10_000;
export const SL_MIN_ROI_PCT = -95; // safe floor above liquidation
export const SL_MAX_ROI_PCT = -1; // just below entry

export function validateTriggerRoi(
  kind: TriggerKind,
  roiPct: number,
): TriggerValidation {
  if (!Number.isFinite(roiPct)) {
    return { ok: false, message: "Enter a valid percentage." };
  }
  if (kind === "tp") {
    if (roiPct <= 0) {
      return {
        ok: false,
        message: "Take-profit must be above entry (in profit).",
      };
    }
    const clamped = Math.min(Math.max(roiPct, TP_MIN_ROI_PCT), TP_MAX_ROI_PCT);
    return { ok: true, roiPct: clamped };
  }
  // stop-loss
  if (roiPct >= 0) {
    return { ok: false, message: "Stop-loss must be below entry." };
  }
  if (roiPct <= -100) {
    return { ok: false, message: "Stop-loss must stay above liquidation." };
  }
  const clamped = Math.min(Math.max(roiPct, SL_MIN_ROI_PCT), SL_MAX_ROI_PCT);
  return { ok: true, roiPct: clamped };
}

/** getTriggerPriceFromRoiSync expects ROI as a plain integer percent. */
export function roiPctToIntegerPercent(roiPct: number): number {
  return Math.round(roiPct);
}

export interface TriggerRoiFromPriceInput {
  entryPriceUsd: number;
  triggerPriceUsd: number;
  sizeUsd: number;
  collateralUsd: number;
  side: FlashSide;
}

/**
 * Approximate ROI on collateral implied by a trigger price (for chip/line
 * display). Exact fills depend on keeper latency + fees, so this is
 * intentionally fee-free and approximate — never promise an exact price.
 *   roi% = priceMove% * (sizeUsd / collateralUsd) * sideSign * 100
 */
export function roiPctFromTriggerPrice(input: TriggerRoiFromPriceInput): number {
  const { entryPriceUsd, triggerPriceUsd, sizeUsd, collateralUsd, side } = input;
  if (
    !Number.isFinite(entryPriceUsd) ||
    entryPriceUsd <= 0 ||
    !Number.isFinite(triggerPriceUsd) ||
    triggerPriceUsd <= 0 ||
    !Number.isFinite(collateralUsd) ||
    collateralUsd <= 0 ||
    !Number.isFinite(sizeUsd) ||
    sizeUsd <= 0
  ) {
    return 0;
  }
  const priceMove = (triggerPriceUsd - entryPriceUsd) / entryPriceUsd;
  const leverage = sizeUsd / collateralUsd;
  const sideSign = side === "long" ? 1 : -1;
  return priceMove * leverage * sideSign * 100;
}
