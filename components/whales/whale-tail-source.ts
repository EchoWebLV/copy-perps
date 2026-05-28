import type { TailSource, WhaleTailPosition } from "@/components/tail/tail-types";
import { isSourceFresh } from "@/lib/whales/identity";
import { isWhaleTailPositionCopyable } from "@/components/tail/whale-tail";
import type { WhaleTraderSignal } from "@/lib/types";

type WhalePayload = WhaleTraderSignal["payload"];
type WhalePosition = WhalePayload["openPositions"][number];

function toTailPosition(
  position: WhalePosition,
  nowMs: number,
): WhaleTailPosition {
  return {
    sourcePositionId: position.positionId,
    asset: position.market,
    side: position.side,
    leverage: position.leverage,
    maxLeverage: position.maxLeverage,
    entryMark: position.entryPrice,
    currentMark: position.currentMark,
    stale:
      position.stale ||
      !isSourceFresh(position.lastSeenAtMs, undefined, nowMs),
    lastSeenAtMs: position.lastSeenAtMs,
    copyableOnPacifica: position.copyableOnPacifica ?? true,
    notionalUsd: position.notionalUsd,
    unrealizedPnlPct: position.unrealizedPnlPct,
  };
}

export function buildWhaleTailSource(
  whale: WhalePayload,
  nowMs = Date.now(),
): Extract<TailSource, { kind: "whale" }> | null {
  if (whale.openPositions.length === 0) return null;

  const positions = whale.openPositions.map((position) =>
    toTailPosition(position, nowMs),
  );
  const primary =
    positions.find((position) =>
      isWhaleTailPositionCopyable(position, nowMs),
    ) ??
    positions.find((position) => !position.stale) ??
    positions[0] ??
    null;
  if (!primary) return null;

  return {
    kind: "whale",
    whaleId: whale.whaleId,
    displayName: whale.displayName,
    avatarUrl: whale.avatarUrl,
    sourceAccount: whale.sourceAccount,
    sourcePositionId: primary.sourcePositionId,
    asset: primary.asset,
    side: primary.side,
    leverage: primary.leverage,
    maxLeverage: primary.maxLeverage,
    entryMark: primary.entryMark,
    currentMark: primary.currentMark,
    stale: primary.stale,
    lastSeenAtMs: primary.lastSeenAtMs,
    positions,
  };
}
