import { describe, expect, it } from "vitest";
import type { WhaleTraderSignal } from "@/lib/types";
import { buildWhaleExposureSummary } from "./whale-exposure-summary";

type WhaleOpenPosition = WhaleTraderSignal["payload"]["openPositions"][number];

function position(
  overrides: Partial<WhaleOpenPosition> = {},
): WhaleOpenPosition {
  return {
    positionId: "pos-1",
    whaleId: "whale-1",
    source: "pacifica",
    sourceAccount: "acct-1",
    displayName: "Whale One",
    avatarUrl: null,
    market: "SOL",
    side: "long",
    leverage: 5,
    amountBase: 10,
    notionalUsd: 50_000,
    entryPrice: 100,
    currentMark: 101,
    unrealizedPnlPct: 5,
    openedAtMs: 1_000,
    lastSeenAtMs: 9 * 60_000,
    stale: false,
    analysis: null,
    ...overrides,
  };
}

describe("buildWhaleExposureSummary", () => {
  it("summarizes open whale positions without listing every position", () => {
    const now = 10 * 60_000;
    const summary = buildWhaleExposureSummary([
      position({ positionId: "sol", market: "SOL", side: "long", notionalUsd: 70_000 }),
      position({ positionId: "eth", market: "ETH", side: "short", notionalUsd: 40_000, stale: true }),
      position({ positionId: "btc", market: "BTC", side: "short", leverage: 50, notionalUsd: 120_000, unrealizedPnlPct: -2 }),
      position({ positionId: "hype", market: "HYPE", side: "long", notionalUsd: 30_000, copyableOnPacifica: false }),
      position({ positionId: "aged", market: "XAU", side: "long", notionalUsd: 20_000, lastSeenAtMs: now - 4 * 60_000 }),
    ], now);

    expect(summary).toMatchObject({
      totalCount: 5,
      copyableCount: 5,
      staleCount: 2,
      longCount: 3,
      shortCount: 2,
      exposureUsd: 280_000,
      stanceLabel: "3 LONG / 2 SHORT",
    });
    expect(summary.largestPosition).toMatchObject({
      market: "BTC",
      side: "short",
      leverage: 50,
      notionalUsd: 120_000,
    });
  });

  it("returns an empty summary when the whale has no positions", () => {
    expect(buildWhaleExposureSummary([])).toEqual({
      totalCount: 0,
      copyableCount: 0,
      staleCount: 0,
      longCount: 0,
      shortCount: 0,
      exposureUsd: 0,
      stanceLabel: "NO OPEN POSITIONS",
      largestPosition: null,
    });
  });
});
