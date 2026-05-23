import type { TailSource, WhaleTailPosition } from "./tail-types";

type WhaleTailSource = Extract<TailSource, { kind: "whale" }>;

export function whalePositionsForTail(
  source: WhaleTailSource,
): WhaleTailPosition[] {
  if (source.positions.length > 0) return source.positions;

  return [
    {
      sourcePositionId: source.sourcePositionId,
      asset: source.asset,
      side: source.side,
      leverage: source.leverage,
      entryMark: source.entryMark,
      currentMark: source.currentMark,
      stale: source.stale,
    },
  ];
}

export function copyableWhalePositionsForTail(
  source: WhaleTailSource,
): WhaleTailPosition[] {
  return whalePositionsForTail(source).filter((position) => !position.stale);
}

export function whaleTailTotalNotional(
  stakeUsdcPerPosition: number,
  positions: WhaleTailPosition[],
): number {
  return positions.reduce(
    (sum, position) => sum + stakeUsdcPerPosition * position.leverage,
    0,
  );
}
