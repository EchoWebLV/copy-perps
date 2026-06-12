import type { TailSource, WhaleTailPosition } from "@/components/tail/tail-types";
import { isSourceFresh } from "@/lib/whales/identity";
import { whaleDisplayName } from "@/lib/whales/alias";
import { isWhaleTailPositionCopyable } from "@/components/tail/whale-tail";
import type { WhaleTraderSignal } from "@/lib/types";
import { isFlashCopyableMarket } from "@/lib/flash/markets";

type WhalePayload = WhaleTraderSignal["payload"];
type WhalePosition = WhalePayload["openPositions"][number];

const PRIMARY_FLASH_MARKETS = new Set(["BTC", "ETH", "SOL"]);

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

  const positions = whale.openPositions
    .filter((position) => isFlashCopyableMarket(position.market))
    .map((position) => toTailPosition(position, nowMs));
  if (positions.length === 0) return null;
  const livePositions = positions.filter((position) =>
    isWhaleTailPositionCopyable(position, nowMs),
  );
  const primary =
    livePositions.find((position) =>
      PRIMARY_FLASH_MARKETS.has(position.asset.toUpperCase()),
    ) ??
    livePositions[0] ??
    positions.find((position) => !position.stale) ??
    positions[0] ??
    null;
  if (!primary) return null;

  return {
    kind: "whale",
    whaleId: whale.whaleId,
    // Address-ish placeholders become the deterministic alias so the modal
    // matches the card the user tapped.
    displayName: whaleDisplayName(whale.displayName, whale.sourceAccount),
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
