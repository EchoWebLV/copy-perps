import type { TailSource, WhaleTailPosition } from "./tail-types";
import { isSourceFresh } from "@/lib/whales/identity";

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
      lastSeenAtMs: source.lastSeenAtMs,
      copyableOnPacifica: true,
    },
  ];
}

export function isWhaleTailPositionCopyable(
  position: WhaleTailPosition,
  nowMs = Date.now(),
): boolean {
  return (
    !position.stale &&
    isSourceFresh(position.lastSeenAtMs, undefined, nowMs) &&
    position.copyableOnPacifica !== false
  );
}

export function copyableWhalePositionsForTail(
  source: WhaleTailSource,
  nowMs = Date.now(),
): WhaleTailPosition[] {
  return whalePositionsForTail(source).filter((position) =>
    isWhaleTailPositionCopyable(position, nowMs),
  );
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
