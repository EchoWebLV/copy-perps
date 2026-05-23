import type { LiveEntryChartPosition } from "@/components/feed/LiveEntryChart";
import type { WhalePositionSignal } from "@/lib/types";

export function toWhaleEntryChartPosition(
  position: WhalePositionSignal["payload"],
  liveMark?: number,
): LiveEntryChartPosition | null {
  const currentMark = liveMark ?? position.currentMark;
  if (currentMark === null || !Number.isFinite(currentMark)) return null;

  return {
    positionId: position.positionId,
    asset: position.market,
    side: position.side,
    leverage: position.leverage,
    entryMark: position.entryPrice,
    currentMark,
    openSinceMs: position.openedAtMs,
  };
}

export function computeWhalePositionPnlPct({
  side,
  leverage,
  entryMark,
  currentMark,
}: {
  side: "long" | "short";
  leverage: number;
  entryMark: number;
  currentMark: number;
}): number {
  if (entryMark <= 0) return 0;
  const move = (currentMark - entryMark) / entryMark;
  const directionalMove = side === "long" ? move : -move;
  return directionalMove * leverage * 100;
}
