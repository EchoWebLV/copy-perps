import { describe, expect, it } from "vitest";
import type { WhalePositionSignal } from "@/lib/types";
import {
  computeWhalePositionPnlPct,
  toWhaleEntryChartPosition,
} from "./whale-entry-chart-position";

function whalePosition(
  overrides: Partial<WhalePositionSignal["payload"]> = {},
): WhalePositionSignal["payload"] {
  return {
    positionId: "pos-1",
    whaleId: "whale-1",
    source: "pacifica",
    sourceAccount: "0xsource",
    displayName: "Whale One",
    avatarUrl: null,
    market: "SOL",
    side: "long",
    leverage: 8,
    amountBase: 12,
    notionalUsd: 1800,
    entryPrice: 150,
    currentMark: 157.5,
    unrealizedPnlPct: 4,
    openedAtMs: 1_000,
    openedAtKnown: true,
    lastSeenAtMs: 2_000,
    stale: false,
    analysis: null,
    ...overrides,
  };
}

describe("toWhaleEntryChartPosition", () => {
  it("maps a whale position into the shared live entry chart shape", () => {
    expect(toWhaleEntryChartPosition(whalePosition())).toEqual({
      positionId: "pos-1",
      asset: "SOL",
      side: "long",
      leverage: 8,
      entryMark: 150,
      currentMark: 157.5,
      openSinceMs: 1_000,
    });
  });

  it("keeps chart props available when the server has no current mark yet", () => {
    expect(
      toWhaleEntryChartPosition(whalePosition({ currentMark: null })),
    ).toMatchObject({
      positionId: "pos-1",
      entryMark: 150,
      currentMark: null,
    });
  });

  it("uses a websocket live mark when the server snapshot has no mark yet", () => {
    expect(
      toWhaleEntryChartPosition(whalePosition({ currentMark: null }), 158),
    ).toMatchObject({
      currentMark: 158,
    });
  });

  it("computes leveraged PnL from entry and current mark for long and short positions", () => {
    expect(
      computeWhalePositionPnlPct({
        side: "long",
        leverage: 5,
        entryMark: 100,
        currentMark: 110,
      }),
    ).toBe(50);
    expect(
      computeWhalePositionPnlPct({
        side: "short",
        leverage: 4,
        entryMark: 100,
        currentMark: 90,
      }),
    ).toBe(40);
  });
});
