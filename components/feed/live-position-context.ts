import type { FlatPosition } from "./live-positions";

export type MarketBias = "long" | "short" | "split";

export interface LivePositionContext {
  peers: FlatPosition[];
  longCount: number;
  shortCount: number;
  bias: MarketBias;
}

export function buildLivePositionContext(
  positions: FlatPosition[],
  selected: FlatPosition,
  limit = 4,
): LivePositionContext {
  const sameAsset = positions.filter(
    (position) => position.asset === selected.asset,
  );
  const longCount = sameAsset.filter(
    (position) => position.side === "long",
  ).length;
  const shortCount = sameAsset.length - longCount;
  const peers = sameAsset
    .filter((position) => position.positionId !== selected.positionId)
    .sort((a, b) => {
      const convictionDelta =
        Math.abs(b.livePaperPnlPct) - Math.abs(a.livePaperPnlPct);
      if (convictionDelta !== 0) return convictionDelta;
      return b.openSinceMs - a.openSinceMs;
    })
    .slice(0, limit);

  return {
    peers,
    longCount,
    shortCount,
    bias:
      longCount > shortCount
        ? "long"
        : shortCount > longCount
          ? "short"
          : "split",
  };
}
