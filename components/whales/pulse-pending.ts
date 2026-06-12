import type { PulseItem } from "./pulse-items";

/**
 * Pure helper: given the full polled item list, the set of positionIds
 * currently visible on the tape, and the set of positionIds already queued
 * in pending, return only the genuinely-new items (unseen by both visible
 * and current pending).
 *
 * Extracted so it can be unit-tested without any React state machinery.
 */
export function selectPendingItems(
  polled: PulseItem[],
  visibleIds: ReadonlySet<string>,
  pendingIds: ReadonlySet<string>,
): PulseItem[] {
  return polled.filter(
    (item) =>
      !visibleIds.has(item.position.positionId) &&
      !pendingIds.has(item.position.positionId),
  );
}
