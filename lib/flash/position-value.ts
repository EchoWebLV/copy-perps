export interface FlashStakePosition {
  sizeUsd?: number | null;
  leverage?: number | null;
  collateralUsd?: number | null;
  entryCostUsd?: number | null;
}

function positiveFiniteNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function roundUsdc(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function flashStakeUsdFromPosition(
  position: FlashStakePosition | null | undefined,
): number | null {
  if (!position) return null;

  const entryCostUsd = positiveFiniteNumber(position.entryCostUsd);
  if (entryCostUsd != null) return roundUsdc(entryCostUsd);

  const sizeUsd = positiveFiniteNumber(position.sizeUsd);
  const leverage = positiveFiniteNumber(position.leverage);
  if (sizeUsd != null && leverage != null) {
    return roundUsdc(sizeUsd / leverage);
  }

  const collateralUsd = positiveFiniteNumber(position.collateralUsd);
  return collateralUsd == null ? null : roundUsdc(collateralUsd);
}
