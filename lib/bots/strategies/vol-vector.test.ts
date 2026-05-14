// lib/bots/strategies/vol-vector.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/data/candles", () => ({
  getCandles: vi.fn(),
}));

import { VolVectorStrategy, VolVectorHairTriggerStrategy } from "./vol-vector";
import { getCandles } from "@/lib/data/candles";
import type { MarketContext, ExternalSignals, PaperPosition } from "../types";

const emptySignals: ExternalSignals = { liquidations: [], funding: {} };

function constantCandles(price: number, n: number, intervalMs: number) {
  return Array.from({ length: n }, (_, i) => ({
    ts: 1_000 + i * intervalMs,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 1,
  }));
}

function trendingCandles(start: number, step: number, n: number, intervalMs: number) {
  return Array.from({ length: n }, (_, i) => {
    const close = start + step * i;
    return {
      ts: 1_000 + i * intervalMs,
      open: close - step,
      high: close,
      low: close - step,
      close,
      volume: 1,
    };
  });
}

describe("VolVector.evaluateEntry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when current vol is at baseline", async () => {
    vi.mocked(getCandles).mockImplementation(async (_asset, tf) => {
      if (tf === "1m") return constantCandles(100, 5, 60_000);
      return constantCandles(100, 24, 60 * 60_000);
    });
    const decision = await VolVectorStrategy.evaluateEntry(
      { asset: "SOL", mark: 100 },
      emptySignals,
    );
    expect(decision).toBeNull();
  });

  it("longs on a vol spike that trends up", async () => {
    vi.mocked(getCandles).mockImplementation(async (_asset, tf) => {
      if (tf === "1m") {
        return trendingCandles(100, 0.3, 5, 60_000);
      }
      return constantCandles(100, 24, 60 * 60_000);
    });
    const decision = await VolVectorStrategy.evaluateEntry(
      { asset: "SOL", mark: 101.5 },
      emptySignals,
    );
    expect(decision).not.toBeNull();
    expect(decision!.side).toBe("long");
  });

  it("shorts on a vol spike that trends down", async () => {
    vi.mocked(getCandles).mockImplementation(async (_asset, tf) => {
      if (tf === "1m") {
        return trendingCandles(100, -0.3, 5, 60_000);
      }
      return constantCandles(100, 24, 60 * 60_000);
    });
    const decision = await VolVectorStrategy.evaluateEntry(
      { asset: "SOL", mark: 98.5 },
      emptySignals,
    );
    expect(decision).not.toBeNull();
    expect(decision!.side).toBe("short");
  });
});

describe("VolVectorHairTrigger (variant)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fires at a lower vol multiplier than the headliner", async () => {
    vi.mocked(getCandles).mockImplementation(async (_asset, tf) => {
      if (tf === "1m") return trendingCandles(100, 0.1, 5, 60_000);
      return constantCandles(100, 24, 60 * 60_000);
    });
    const headliner = await VolVectorStrategy.evaluateEntry(
      { asset: "SOL", mark: 100.5 },
      emptySignals,
    );
    const hair = await VolVectorHairTriggerStrategy.evaluateEntry(
      { asset: "SOL", mark: 100.5 },
      emptySignals,
    );
    expect(hair !== null || headliner === null).toBe(true);
  });
});

describe("VolVector.evaluateExit", () => {
  const openLong: PaperPosition = {
    id: "p1",
    botId: "vol-vector",
    asset: "SOL",
    side: "long",
    leverage: 30,
    stakeUsd: 100,
    entryMark: 100,
    entryTs: new Date(),
    exitMark: null,
    exitTs: null,
    paperPnlUsd: null,
    triggerMeta: null,
    narrationOpen: null,
    narrationClose: null,
    status: "open",
  };

  it("exits on a 0.6% favorable move", () => {
    expect(
      VolVectorStrategy.evaluateExit(
        { asset: "SOL", mark: 100.7 },
        openLong,
      ),
    ).toBe(true);
  });

  it("exits after 15min max hold", () => {
    const old: PaperPosition = {
      ...openLong,
      entryTs: new Date(Date.now() - 20 * 60 * 1000),
    };
    expect(
      VolVectorStrategy.evaluateExit({ asset: "SOL", mark: 100 }, old),
    ).toBe(true);
  });
});
