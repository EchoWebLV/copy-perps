// lib/bots/strategies/boomer-trend.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/data/candles", () => ({
  getCandles: vi.fn(),
}));

import { BoomerTrendStrategy, BoomerTrendWideStrategy } from "./boomer-trend";
import { getCandles } from "@/lib/data/candles";
import type { MarketContext, ExternalSignals, PaperPosition } from "../types";

const emptySignals: ExternalSignals = { liquidations: [], funding: {} };

// Build candles where fast EMA crosses above slow at the very end
function bullCrossCandles() {
  const flat = Array.from({ length: 25 }, (_, i) => ({
    ts: 1_000 + i * 4 * 60 * 60_000,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 1,
  }));
  const rising = Array.from({ length: 5 }, (_, i) => {
    const close = 102 + i * 2;
    return {
      ts: 1_000 + (25 + i) * 4 * 60 * 60_000,
      open: close - 1,
      high: close,
      low: close - 1,
      close,
      volume: 1,
    };
  });
  return [...flat, ...rising];
}

function bearCrossCandles() {
  const flat = Array.from({ length: 25 }, (_, i) => ({
    ts: 1_000 + i * 4 * 60 * 60_000,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 1,
  }));
  const falling = Array.from({ length: 5 }, (_, i) => {
    const close = 98 - i * 2;
    return {
      ts: 1_000 + (25 + i) * 4 * 60 * 60_000,
      open: close + 1,
      high: close + 1,
      low: close,
      close,
      volume: 1,
    };
  });
  return [...flat, ...falling];
}

describe("BoomerTrend.evaluateEntry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("longs after a bullish EMA crossover", async () => {
    vi.mocked(getCandles).mockResolvedValue(bullCrossCandles());
    const decision = await BoomerTrendStrategy.evaluateEntry(
      { asset: "BTC", mark: 110 },
      emptySignals,
    );
    expect(decision).not.toBeNull();
    expect(decision!.side).toBe("long");
  });

  it("shorts after a bearish EMA crossover", async () => {
    vi.mocked(getCandles).mockResolvedValue(bearCrossCandles());
    const decision = await BoomerTrendStrategy.evaluateEntry(
      { asset: "BTC", mark: 90 },
      emptySignals,
    );
    expect(decision).not.toBeNull();
    expect(decision!.side).toBe("short");
  });

  it("returns null when no crossover (flat market)", async () => {
    vi.mocked(getCandles).mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({
        ts: 1_000 + i * 4 * 60 * 60_000,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1,
      })),
    );
    const decision = await BoomerTrendStrategy.evaluateEntry(
      { asset: "BTC", mark: 100 },
      emptySignals,
    );
    expect(decision).toBeNull();
  });

  it("rejects unsupported asset", async () => {
    vi.mocked(getCandles).mockResolvedValue(bullCrossCandles());
    const decision = await BoomerTrendStrategy.evaluateEntry(
      { asset: "DOGE", mark: 0.1 },
      emptySignals,
    );
    expect(decision).toBeNull();
  });
});

describe("BoomerTrend.evaluateExit", () => {
  const openLong: PaperPosition = {
    id: "p1",
    botId: "boomer-trend",
    asset: "BTC",
    side: "long",
    leverage: 10,
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

  it("exits after 48h max hold", () => {
    const old: PaperPosition = {
      ...openLong,
      entryTs: new Date(Date.now() - 50 * 60 * 60 * 1000),
    };
    expect(
      BoomerTrendStrategy.evaluateExit({ asset: "BTC", mark: 100 }, old),
    ).toBe(true);
  });

  it("exits on 3% favorable move", () => {
    expect(
      BoomerTrendStrategy.evaluateExit({ asset: "BTC", mark: 103 }, openLong),
    ).toBe(true);
  });
});

describe("BoomerTrendWide (variant)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses wider EMA windows — should not crash on a strong bull cross", async () => {
    vi.mocked(getCandles).mockResolvedValue(bullCrossCandles());
    const decision = await BoomerTrendWideStrategy.evaluateEntry(
      { asset: "BTC", mark: 110 },
      emptySignals,
    );
    expect(decision === null || decision.side === "long").toBe(true);
  });
});
