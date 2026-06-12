import { describe, expect, it } from "vitest";
import { selectPendingItems } from "./pulse-pending";
import type { PulseItem } from "./pulse-items";

function makeItem(positionId: string): PulseItem {
  return {
    id: `${positionId}:holding`,
    kind: "holding",
    score: 0,
    eyebrow: "Holding",
    headline: "test",
    context: "test",
    reactionSeed: 0,
    canTail: false,
    position: {
      positionId,
      whaleId: "whale-1",
      displayName: "Whale",
      source: "hyperliquid",
      sourceAccount: "0xabc",
      avatarUrl: null,
      market: "SOL",
      side: "long",
      leverage: 5,
      maxLeverage: 20,
      notionalUsd: 10_000,
      entryPrice: 150,
      currentMark: 155,
      unrealizedPnlPct: 3.3,
      openedAtMs: Date.now() - 60_000,
      openedAtKnown: true,
      lastSeenAtMs: Date.now(),
      stale: false,
      analysis: null,
      copyableOnPacifica: false,
      amountBase: 0,
    },
  };
}

describe("selectPendingItems", () => {
  it("returns only IDs not in visible or pending sets", () => {
    const A = makeItem("A");
    const B = makeItem("B");
    const C = makeItem("C");

    const result = selectPendingItems(
      [A, B, C],
      new Set(["A", "B"]),
      new Set(),
    );
    expect(result).toHaveLength(1);
    expect(result[0].position.positionId).toBe("C");
  });

  it("after drain + re-poll with same set, pending stays empty", () => {
    const A = makeItem("A");
    const B = makeItem("B");
    const C = makeItem("C");

    // First poll while scrolled: visible=[A,B], pending=[]
    const first = selectPendingItems([A, B, C], new Set(["A", "B"]), new Set());
    // C is new → pendingIds now = {C}
    const pendingIds = new Set(first.map((i) => i.position.positionId));
    expect(pendingIds.has("C")).toBe(true);

    // Simulate drain: visible becomes [A,B,C], pending=[]
    const visibleAfterDrain = new Set(["A", "B", "C"]);

    // Re-poll returns same set [A,B,C] → nothing new
    const second = selectPendingItems(
      [A, B, C],
      visibleAfterDrain,
      new Set(),
    );
    expect(second).toHaveLength(0);
  });

  it("scenario: visible=[A,B] → poll [A,B,C] → pending=[C], count=1; drain; re-poll [A,B,C] → pending stays empty", () => {
    const A = makeItem("A");
    const B = makeItem("B");
    const C = makeItem("C");

    // Step 1: scroll-down poll
    const pending1 = selectPendingItems(
      [A, B, C],
      new Set(["A", "B"]),
      new Set(),
    );
    expect(pending1).toHaveLength(1);
    expect(pending1[0].position.positionId).toBe("C");

    // Step 2: drain → visible now has [A,B,C]
    const visibleIds = new Set(["A", "B", "C"]);

    // Step 3: next poll, same tape [A,B,C]
    const pending2 = selectPendingItems([A, B, C], visibleIds, new Set());
    expect(pending2).toHaveLength(0);
  });

  it("also dedupes against current pendingIds, not just visible", () => {
    const A = makeItem("A");
    const B = makeItem("B");
    const C = makeItem("C");
    const D = makeItem("D");

    // C already in pending from a prior poll, D is brand new
    const result = selectPendingItems(
      [A, B, C, D],
      new Set(["A", "B"]),
      new Set(["C"]),
    );
    expect(result).toHaveLength(1);
    expect(result[0].position.positionId).toBe("D");
  });
});
