import { describe, expect, it } from "vitest";
import type { WhalePositionSignal } from "@/lib/types";
import { buildMarketHeatRows } from "./WhaleMarketHeatmap";

describe("buildMarketHeatRows", () => {
  it("keeps pinned major markets in a stable order before live-ranked overflow markets", () => {
    const now = 1_700_000_000_000;
    const rows = buildMarketHeatRows(
      [
        signal("ZEC", 5_000_000),
        signal("HYPE", 9_000_000),
        signal("BTC", 100_000),
        signal("SOL", 7_000_000),
        signal("ETH", 50_000),
        signal("AAVE", 4_000_000),
        signal("DOGE", 1_000),
        signal("XRP", 2_000),
      ],
      now,
    );

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

  it("excludes stale and aged positions from live heat rows", () => {
    const now = Date.now();
    const rows = buildMarketHeatRows(
      [
        signal("BTC", 100_000, {
          positionId: "live-btc",
          lastSeenAtMs: now - 30_000,
        }),
        signal("BTC", 800_000, {
          positionId: "flagged-stale-btc",
          lastSeenAtMs: now - 30_000,
          stale: true,
        }),
        signal("BTC", 900_000, {
          positionId: "aged-btc",
          lastSeenAtMs: now - 4 * 60_000,
        }),
        signal("ETH", 1_000_000, {
          positionId: "aged-eth",
          lastSeenAtMs: now - 4 * 60_000,
        }),
      ],
      now,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.market).toBe("BTC");
    expect(rows[0]?.totalNotional).toBe(100_000);
    expect(rows[0]?.positions.map((position) => position.positionId)).toEqual([
      "live-btc",
    ]);
  });
});

function signal(
  market: string,
  notionalUsd: number,
  overrides: Partial<WhalePositionSignal["payload"]> = {},
): WhalePositionSignal {
  const now = 1_700_000_000_000;
  return {
    id: `whale_position:${market}`,
    type: "whale_position",
    heatScore: notionalUsd,
    createdAt: new Date(now).toISOString(),
    chips: [],
    payload: {
      positionId: overrides.positionId ?? `${market}-pos`,
      whaleId: overrides.whaleId ?? `${market}-whale`,
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
      openedAtMs: overrides.openedAtMs ?? now - 60_000,
      lastSeenAtMs: overrides.lastSeenAtMs ?? now,
      stale: overrides.stale ?? false,
      copyableOnPacifica: false,
      analysis: null,
    },
  };
}
