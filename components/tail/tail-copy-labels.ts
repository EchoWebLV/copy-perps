import type { WhaleTailPosition } from "./tail-types";

function isSinglePosition(positions: WhaleTailPosition[]): boolean {
  return positions.length === 1;
}

export function whaleTailPositionsHeading(
  positions: WhaleTailPosition[],
): string {
  return isSinglePosition(positions)
    ? "Position to copy"
    : "Current open positions";
}

export function whaleTailFollowingText({
  sourceName,
  positions,
  copyableCount,
}: {
  sourceName: string;
  positions: WhaleTailPosition[];
  copyableCount: number;
}): string {
  if (isSinglePosition(positions)) {
    const position = positions[0];
    if (!position) return `${sourceName}'s position`;
    return `${sourceName}'s ${position.asset} ${position.side.toUpperCase()} position`;
  }

  return `${sourceName}'s ${copyableCount} ready position${copyableCount === 1 ? "" : "s"}`;
}

export function whaleTailAutoCloseLabel(
  positions: WhaleTailPosition[],
): string {
  return isSinglePosition(positions)
    ? "Close my copy when position closes"
    : "Close my copies when whale closes";
}

export function whaleTailPrimaryCta({
  positions,
  effectiveStake,
}: {
  positions: WhaleTailPosition[];
  effectiveStake: number;
}): string {
  const stakeText = effectiveStake.toFixed(0);
  return isSinglePosition(positions)
    ? `Copy with $${stakeText}`
    : `Copy ${positions.length} positions · $${stakeText} each`;
}
