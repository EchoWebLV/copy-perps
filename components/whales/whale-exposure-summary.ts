import type { WhaleTraderSignal } from "@/lib/types";

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
): WhaleExposureSummary {
  let copyableCount = 0;
  let longCount = 0;
  let shortCount = 0;
  let exposureUsd = 0;
  let largestPosition: WhaleOpenPosition | null = null;

  for (const position of positions) {
    if (!position.stale && position.copyableOnPacifica !== false) {
      copyableCount += 1;
    }
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
    staleCount: totalCount - copyableCount,
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
