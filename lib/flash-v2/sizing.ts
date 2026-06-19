// lib/flash-v2/sizing.ts
/** Triggers/limit orders require > $10 collateral after fees (GOTCHAS). */
export const MIN_TRIGGER_COLLATERAL_USD = 11;

/**
 * Effective size ≠ collateral × leverage — fills execute at oracle ± entry
 * spread, which reshapes size (GOTCHAS). entrySpreadFrac is a fraction (0.1 = 10%).
 */
export function effectiveSizeUsd(
  collateralUsd: number,
  leverage: number,
  entrySpreadFrac: number,
): number {
  if (collateralUsd <= 0 || leverage <= 0) {
    throw new Error("collateral and leverage must be positive");
  }
  return collateralUsd * leverage * (1 - entrySpreadFrac);
}

export function effectiveLeverage(sizeUsd: number, collateralUsd: number): number {
  if (collateralUsd <= 0) throw new Error("collateral must be positive");
  return sizeUsd / collateralUsd;
}

export function meetsTriggerMinimum(collateralUsd: number): boolean {
  return collateralUsd >= MIN_TRIGGER_COLLATERAL_USD;
}
