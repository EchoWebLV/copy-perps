import { describe, expect, it } from "vitest";
import { buildWhaleTailSource } from "./whale-tail-source";
import type { WhaleTraderSignal } from "@/lib/types";

const position = (
  id: string,
  market: string,
  stale = false,
  copyableOnPacifica = true,
): WhaleTraderSignal["payload"]["openPositions"][number] => ({
  positionId: id,
  whaleId: "whale-1",
  source: "pacifica",
  sourceAccount: "acct-1",
  displayName: "Alpha Whale",
  avatarUrl: null,
  market,
  side: market === "ETH" ? "short" : "long",
  leverage: market === "ETH" ? 4 : 7,
  amountBase: 1,
  notionalUsd: market === "ETH" ? 40000 : 70000,
  entryPrice: market === "ETH" ? 3000 : 100,
  currentMark: market === "ETH" ? 2950 : 104,
  unrealizedPnlPct: market === "ETH" ? 1.2 : 4,
  openedAtMs: 1779540000000,
  lastSeenAtMs: 1779540300000,
  stale,
  copyableOnPacifica,
  analysis: null,
});

describe("buildWhaleTailSource", () => {
  it("builds one whale tail source containing every Flash-copyable position", () => {
    const now = Date.parse("2026-05-23T12:00:00.000Z");
    const source = buildWhaleTailSource({
      whaleId: "whale-1",
      source: "pacifica",
      sourceAccount: "acct-1",
      displayName: "Alpha Whale",
      avatarUrl: null,
      tags: [],
      openPositionsCount: 3,
      openPositions: [
        position("stale-btc", "BTC", true),
        position("fresh-hype", "HYPE", false, false),
        position("fresh-sol", "SOL"),
        position("fresh-eth", "ETH"),
      ],
      bestPosition: null,
      stats: {
        equityUsdc: 100000,
        openInterestUsdc: 200000,
        pnl1dUsdc: 100,
        pnl7dUsdc: 200,
        pnl30dUsdc: 300,
        pnlAllTimeUsdc: 400,
        pnlCurve: [],
        winRatePct1d: null,
        totalCloses1d: 0,
        volume1dUsdc: 500000,
      },
      lastSeenAt: "2026-05-23T12:00:00.000Z",
      stale: false,
    }, now);

    expect(source?.displayName).toBe("Alpha Whale");
    expect(source?.sourcePositionId).toBe("fresh-sol");
    expect(source?.asset).toBe("SOL");
    expect(source?.positions.map((p) => p.sourcePositionId)).toEqual([
      "stale-btc",
      "fresh-sol",
      "fresh-eth",
    ]);
    expect(source?.positions.some((p) => p.asset === "HYPE")).toBe(false);
  });

  it("returns null when the whale has no Flash-copyable positions", () => {
    const now = Date.parse("2026-05-23T12:00:00.000Z");
    const source = buildWhaleTailSource({
      whaleId: "whale-1",
      source: "hyperliquid",
      sourceAccount: "acct-1",
      displayName: "Alpha Whale",
      avatarUrl: null,
      tags: [],
      openPositionsCount: 2,
      openPositions: [
        position("fresh-hype", "HYPE"),
        position("fresh-near", "NEAR"),
      ],
      bestPosition: null,
      stats: {
        equityUsdc: 100000,
        openInterestUsdc: 200000,
        pnl1dUsdc: 100,
        pnl7dUsdc: 200,
        pnl30dUsdc: 300,
        pnlAllTimeUsdc: 400,
        pnlCurve: [],
        winRatePct1d: null,
        totalCloses1d: 0,
        volume1dUsdc: 500000,
      },
      lastSeenAt: "2026-05-23T12:00:00.000Z",
      stale: false,
    }, now);

    expect(source).toBeNull();
  });
});
