import { flashStakeUsdFromPosition, type FlashStakePosition } from "./position-value";

export type FlashLivePositionSide = "long" | "short";

export interface FlashLivePosition extends FlashStakePosition {
  symbol?: string | null;
  side: FlashLivePositionSide;
  positionPubkey?: string | null;
  marketAccount?: string | null;
  entryPriceUsd?: number | null;
  markPriceUsd?: number | null;
  liquidationPriceUsd?: number | null;
  pnlUsd?: number | null;
  receiveUsd?: number | null;
  openFeeUsd?: number | null;
  openTime?: number | null;
}

export interface FlashLivePositionView {
  markPriceUsd: number | null;
  pnlUsd: number;
  valueUsd: number;
  exitValueUsd: number;
  stakeUsd: number;
  roiPct: number;
  liquidationMovePct: number | null;
  isEstimated: boolean;
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function pricePnlUsd(position: FlashLivePosition, markPriceUsd: number): number | null {
  const entry = positiveNumber(position.entryPriceUsd);
  const size = positiveNumber(position.sizeUsd);
  if (entry == null || size == null) return null;
  const priceMove =
    position.side === "long"
      ? (markPriceUsd - entry) / entry
      : (entry - markPriceUsd) / entry;
  return size * priceMove;
}

function nearlyEqualUsd(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

function pnlIsAlreadyNetToStake(
  position: FlashLivePosition,
  stakeUsd: number,
  exactPnlUsd: number | null,
): boolean {
  const receiveUsd = positiveNumber(position.receiveUsd);
  return (
    receiveUsd != null &&
    exactPnlUsd != null &&
    stakeUsd > 0 &&
    nearlyEqualUsd(stakeUsd + exactPnlUsd, receiveUsd)
  );
}

function openFeeUsdForPosition(
  position: FlashLivePosition,
  stakeUsd: number,
  exactPnlUsd: number | null,
): number {
  const openFeeUsd = finiteNumber(position.openFeeUsd);
  if (openFeeUsd != null) return openFeeUsd;

  const collateralUsd = positiveNumber(position.collateralUsd);
  if (
    stakeUsd > 0 &&
    collateralUsd != null &&
    stakeUsd > collateralUsd &&
    !pnlIsAlreadyNetToStake(position, stakeUsd, exactPnlUsd)
  ) {
    return stakeUsd - collateralUsd;
  }

  return 0;
}

export function computeFlashLivePositionView({
  position,
  liveMarkUsd,
}: {
  position: FlashLivePosition | null | undefined;
  liveMarkUsd?: number | null;
}): FlashLivePositionView {
  if (!position) {
    return {
      markPriceUsd: null,
      pnlUsd: 0,
      valueUsd: 0,
      exitValueUsd: 0,
      stakeUsd: 0,
      roiPct: 0,
      liquidationMovePct: null,
      isEstimated: false,
    };
  }

  const stakeUsd = flashStakeUsdFromPosition(position) ?? 0;
  const entryMark = positiveNumber(position.entryPriceUsd);
  const quoteMark = positiveNumber(position.markPriceUsd) ?? entryMark;
  const liveMark = positiveNumber(liveMarkUsd);
  const markPriceUsd = liveMark ?? quoteMark ?? entryMark;
  const exactPnlUsd = finiteNumber(position.pnlUsd);
  const openFeeUsd = openFeeUsdForPosition(position, stakeUsd, exactPnlUsd);
  const isEstimated = liveMark != null && liveMark !== quoteMark;

  let pnlUsd = exactPnlUsd == null ? 0 : exactPnlUsd - openFeeUsd;
  if (markPriceUsd != null && isEstimated) {
    const livePricePnl = pricePnlUsd(position, markPriceUsd);
    const quotePricePnl = quoteMark == null ? null : pricePnlUsd(position, quoteMark);
    if (livePricePnl != null) {
      const flashAdjustment =
        exactPnlUsd != null && quotePricePnl != null
          ? exactPnlUsd - openFeeUsd - quotePricePnl
          : -openFeeUsd;
      pnlUsd = livePricePnl + flashAdjustment;
    }
  } else if (exactPnlUsd == null && markPriceUsd != null) {
    pnlUsd = (pricePnlUsd(position, markPriceUsd) ?? 0) - openFeeUsd;
  }

  const estimatedValueUsd = Math.max(0, stakeUsd + pnlUsd);
  const exactReceiveUsd = positiveNumber(position.receiveUsd);
  const exitValueUsd = isEstimated
    ? estimatedValueUsd
    : exactReceiveUsd ?? estimatedValueUsd;
  const valueUsd = isEstimated ? estimatedValueUsd : exitValueUsd;
  const roiPct = stakeUsd > 0 ? (pnlUsd / stakeUsd) * 100 : 0;
  const liquidationPriceUsd = positiveNumber(position.liquidationPriceUsd);
  const liquidationMovePct =
    markPriceUsd != null && liquidationPriceUsd != null
      ? ((liquidationPriceUsd - markPriceUsd) / markPriceUsd) * 100
      : null;

  return {
    markPriceUsd: markPriceUsd ?? null,
    pnlUsd,
    valueUsd,
    exitValueUsd,
    stakeUsd,
    roiPct,
    liquidationMovePct,
    isEstimated,
  };
}
