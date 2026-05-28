import { describe, expect, it } from "vitest";
import type { WhalePositionSignal } from "@/lib/types";
import { buildMarketHeatRows } from "./WhaleMarketHeatmap";

describe("buildMarketHeatRows", () => {
  it("keeps pinned major markets in a stable order before live-ranked overflow markets", () => {
    const rows = buildMarketHeatRows([
      signal("ZEC", 5_000_000),
      signal("HYPE", 9_000_000),
      signal("BTC", 100_000),
      signal("SOL", 7_000_000),
      signal("ETH", 50_000),
      signal("AAVE", 4_000_000),
      signal("DOGE", 1_000),
      signal("XRP", 2_000),
    ]);

    expect(rows.map((row) => row.market)).toEqual([
      "BTC",
      "ETH",
      "SOL",
      "HYPE",
      "XRP",
      "DOGE",
      "ZEC",
      "AAVE",
    ]);
  });
});

function signal(market: string, notionalUsd: number): WhalePositionSignal {
  const now = 1_700_000_000_000;
  return {
    id: `whale_position:${market}`,
    type: "whale_position",
    heatScore: notionalUsd,
    createdAt: new Date(now).toISOString(),
    chips: [],
    payload: {
      positionId: `${market}-pos`,
      whaleId: `${market}-whale`,
      source: "hyperliquid",
      sourceAccount: `${market}-account`,
      displayName: `${market} Whale`,
      avatarUrl: null,
      market,
      side: "long",
      leverage: 5,
      maxLeverage: 20,
      amountBase: 1,
      notionalUsd,
      entryPrice: 100,
      currentMark: 101,
      unrealizedPnlPct: 1,
      openedAtMs: now - 60_000,
      lastSeenAtMs: now,
      stale: false,
      copyableOnPacifica: false,
      analysis: null,
    },
  };
}
