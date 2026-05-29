export interface FlashStakePosition {
  sizeUsd?: number | null;
  leverage?: number | null;
  collateralUsd?: number | null;
  entryCostUsd?: number | null;
  pnlUsd?: number | null;
  isProfitable?: boolean | null;
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

function configuredFlashLeverage(leverage: number): number | null {
  return (
    CONFIGURED_FLASH_LEVERAGES.find(
      (option) => Math.abs(option - leverage) < 1e-9,
    ) ?? null
  );
}

function isProfitablePosition(position: FlashStakePosition): boolean {
  if (position.isProfitable === true) return true;
  const pnlUsd = Number(position.pnlUsd);
  return Number.isFinite(pnlUsd) && pnlUsd > 0;
}

function requestedFlashLeverageFromEffective(
  leverage: number,
  isProfitable: boolean,
): number {
  if (isProfitable) {
    return (
      CONFIGURED_FLASH_LEVERAGES.find((option) => option >= leverage) ?? leverage
    );
  }

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
  const leverage = positiveFiniteNumber(position.leverage);
  const requestedLeverage =
    leverage == null ? null : configuredFlashLeverage(leverage);
  if (entryCostUsd != null && requestedLeverage != null) {
    return requestedLeverage;
  }

  if (sizeUsd != null && entryCostUsd != null) {
    return requestedFlashLeverageFromNotional(sizeUsd, entryCostUsd);
  }

  if (leverage != null) {
    return requestedFlashLeverageFromEffective(
      leverage,
      isProfitablePosition(position),
    );
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
