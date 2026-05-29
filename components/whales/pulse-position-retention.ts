import type { WhalePositionSignal } from "@/lib/types";
import { isSourceFresh } from "@/lib/whales/identity";

const RECENT_OPEN_RETENTION_MS = 60 * 60_000;
const RECENT_SEEN_RETENTION_MS = 10 * 60_000;

export function mergePulsePositionSignals(
  current: WhalePositionSignal[],
  incoming: WhalePositionSignal[],
  nowMs: number,
): WhalePositionSignal[] {
  if (current.length === 0 || incoming.length === 0) {
    return incoming.length > 0 ? incoming : current;
  }

  const incomingIds = new Set(
    incoming.map((signal) => signal.payload.positionId),
  );
  const retained = current.filter(
    (signal) =>
      !incomingIds.has(signal.payload.positionId) &&
      shouldRetainMissingPulsePosition(signal, nowMs),
  );

  return [...incoming, ...retained];
}

function shouldRetainMissingPulsePosition(
  signal: WhalePositionSignal,
  nowMs: number,
): boolean {
  const { openedAtMs, lastSeenAtMs } = signal.payload;
  return (
    nowMs - openedAtMs < RECENT_OPEN_RETENTION_MS ||
    isSourceFresh(lastSeenAtMs, RECENT_SEEN_RETENTION_MS, nowMs)
  );
}
