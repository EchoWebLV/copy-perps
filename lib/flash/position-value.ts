export interface FlashStakePosition {
  sizeUsd?: number | null;
  leverage?: number | null;
  collateralUsd?: number | null;
  entryCostUsd?: number | null;
  pnlUsd?: number | null;
  isProfitable?: boolean | null;
}

const CONFIGURED_FLASH_LEVERAGES = [1, 5, 10, 20, 25, 50, 100, 125, 250, 500];
const LEVERAGE_SNAP_TOLERANCE = 0.04;

function positiveFiniteNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function roundUsdc(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function configuredFlashLeverage(leverage: number): number | null {
  return (
    CONFIGURED_FLASH_LEVERAGES.find(
      (option) => Math.abs(option - leverage) < 1e-9,
    ) ?? null
  );
}

function snapToConfiguredLeverage(leverage: number): number {
  return (
    CONFIGURED_FLASH_LEVERAGES.find(
      (option) => leverage <= option * (1 + LEVERAGE_SNAP_TOLERANCE),
    ) ?? CONFIGURED_FLASH_LEVERAGES[CONFIGURED_FLASH_LEVERAGES.length - 1]
  );
}

export function flashRequestedLeverageFromPosition(
  position: FlashStakePosition | null | undefined,
): number | null {
  if (!position) return null;

  const sizeUsd = positiveFiniteNumber(position.sizeUsd);
  const entryCostUsd = positiveFiniteNumber(position.entryCostUsd);
  const leverage = positiveFiniteNumber(position.leverage);
  const requestedLeverage =
    leverage == null ? null : configuredFlashLeverage(leverage);
  if (entryCostUsd != null && requestedLeverage != null) {
    return requestedLeverage;
  }

  if (sizeUsd != null && entryCostUsd != null) {
    return snapToConfiguredLeverage(sizeUsd / entryCostUsd);
  }

  if (leverage != null) {
    return snapToConfiguredLeverage(leverage);
  }

  return null;
}

export function flashStakeUsdFromPosition(
  position: FlashStakePosition | null | undefined,
): number | null {
  if (!position) return null;

  const entryCostUsd = positiveFiniteNumber(position.entryCostUsd);
  if (entryCostUsd != null) return roundUsdc(entryCostUsd);

  const sizeUsd = positiveFiniteNumber(position.sizeUsd);
  const leverage = flashRequestedLeverageFromPosition(position);
  if (sizeUsd != null && leverage != null && leverage > 0) {
    return roundUsdc(sizeUsd / leverage);
  }

  const collateralUsd = positiveFiniteNumber(position.collateralUsd);
  return collateralUsd == null ? null : roundUsdc(collateralUsd);
}
