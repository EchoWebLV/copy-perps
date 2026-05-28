import type { WhaleTraderSignal } from "@/lib/types";
import { isFlashCopyableMarket } from "@/lib/flash/markets";
import { isSourceFresh } from "@/lib/whales/identity";

type WhaleOpenPosition = WhaleTraderSignal["payload"]["openPositions"][number];

export interface WhaleExposureSummary {
  totalCount: number;
  copyableCount: number;
  staleCount: number;
  longCount: number;
  shortCount: number;
  exposureUsd: number;
  stanceLabel: string;
  largestPosition: WhaleOpenPosition | null;
}

export function buildWhaleExposureSummary(
  positions: WhaleOpenPosition[],
  nowMs = Date.now(),
): WhaleExposureSummary {
  let copyableCount = 0;
  let staleCount = 0;
  let longCount = 0;
  let shortCount = 0;
  let exposureUsd = 0;
  let largestPosition: WhaleOpenPosition | null = null;

  for (const position of positions) {
    if (isWhaleOpenPositionSupported(position)) {
      copyableCount += 1;
    }
    if (isWhaleOpenPositionStale(position, nowMs)) staleCount += 1;
    if (position.side === "long") longCount += 1;
    else shortCount += 1;
    exposureUsd += position.notionalUsd;
    if (
      largestPosition === null ||
      position.notionalUsd > largestPosition.notionalUsd
    ) {
      largestPosition = position;
    }
  }

  const totalCount = positions.length;

  return {
    totalCount,
    copyableCount,
    staleCount,
    longCount,
    shortCount,
    exposureUsd,
    stanceLabel:
      totalCount === 0
        ? "NO OPEN POSITIONS"
        : `${longCount} LONG / ${shortCount} SHORT`,
    largestPosition,
  };
}

function isWhaleOpenPositionSupported(position: WhaleOpenPosition): boolean {
  return isFlashCopyableMarket(position.market);
}

function isWhaleOpenPositionStale(
  position: WhaleOpenPosition,
  nowMs: number,
): boolean {
  return (
    position.stale ||
    (nowMs > 0 && !isSourceFresh(position.lastSeenAtMs, undefined, nowMs))
  );
}
