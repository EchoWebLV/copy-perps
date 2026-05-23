import type { TailSource, WhaleTailPosition } from "@/components/tail/tail-types";
import { isWhaleTailPositionCopyable } from "@/components/tail/whale-tail";
import type { WhaleTraderSignal } from "@/lib/types";

type WhalePayload = WhaleTraderSignal["payload"];
type WhalePosition = WhalePayload["openPositions"][number];

function toTailPosition(position: WhalePosition): WhaleTailPosition {
  return {
    sourcePositionId: position.positionId,
    asset: position.market,
    side: position.side,
    leverage: position.leverage,
    entryMark: position.entryPrice,
    currentMark: position.currentMark,
    stale: position.stale,
    copyableOnPacifica: position.copyableOnPacifica ?? true,
    notionalUsd: position.notionalUsd,
    unrealizedPnlPct: position.unrealizedPnlPct,
  };
}

export function buildWhaleTailSource(whale: WhalePayload): Extract<
  TailSource,
  { kind: "whale" }
> | null {
  if (whale.openPositions.length === 0) return null;

  const positions = whale.openPositions.map(toTailPosition);
  const primary =
    positions.find(isWhaleTailPositionCopyable) ??
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
    entryMark: primary.entryMark,
    currentMark: primary.currentMark,
    stale: primary.stale,
    positions,
  };
}
