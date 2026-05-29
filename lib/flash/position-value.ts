export interface FlashStakePosition {
  sizeUsd?: number | null;
  leverage?: number | null;
  collateralUsd?: number | null;
  entryCostUsd?: number | null;
}

const CONFIGURED_FLASH_LEVERAGES = [1, 5, 10, 20, 25, 50, 100, 125, 250, 500];
const MAX_EFFECTIVE_LEVERAGE_OVERAGE = 0.12;

function positiveFiniteNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function roundUsdc(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function requestedFlashLeverageFromEffective(leverage: number): number {
  const configured = CONFIGURED_FLASH_LEVERAGES.filter(
    (option) => option <= leverage,
  ).at(-1);
  if (
    configured != null &&
    leverage / configured <= 1 + MAX_EFFECTIVE_LEVERAGE_OVERAGE
  ) {
    return configured;
  }
  return leverage;
}

function requestedFlashLeverageFromNotional(
  sizeUsd: number,
  entryCostUsd: number,
): number {
  const rawLeverage = sizeUsd / entryCostUsd;
  const configured = CONFIGURED_FLASH_LEVERAGES.reduce((best, option) => {
    return Math.abs(option - rawLeverage) < Math.abs(best - rawLeverage)
      ? option
      : best;
  }, CONFIGURED_FLASH_LEVERAGES[0]);

  if (
    configured != null &&
    Math.abs(rawLeverage - configured) / configured <=
      MAX_EFFECTIVE_LEVERAGE_OVERAGE
  ) {
    return configured;
  }

  return rawLeverage;
}

export function flashRequestedLeverageFromPosition(
  position: FlashStakePosition | null | undefined,
): number | null {
  if (!position) return null;

  const sizeUsd = positiveFiniteNumber(position.sizeUsd);
  const entryCostUsd = positiveFiniteNumber(position.entryCostUsd);
  if (sizeUsd != null && entryCostUsd != null) {
    return requestedFlashLeverageFromNotional(sizeUsd, entryCostUsd);
  }

  const leverage = positiveFiniteNumber(position.leverage);
  if (leverage != null) {
    return requestedFlashLeverageFromEffective(leverage);
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
  const leverage = positiveFiniteNumber(position.leverage);
  if (sizeUsd != null && leverage != null) {
    return roundUsdc(sizeUsd / requestedFlashLeverageFromEffective(leverage));
  }

  const collateralUsd = positiveFiniteNumber(position.collateralUsd);
  return collateralUsd == null ? null : roundUsdc(collateralUsd);
}
