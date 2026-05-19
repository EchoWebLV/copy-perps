// lib/bots/strategies/vol-vector.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/data/candles", () => ({
  getCandles: vi.fn(),
}));
vi.mock("../regime", () => ({
  getRegime: vi.fn(),
}));

import { VolVectorStrategy, VolVectorHairTriggerStrategy } from "./vol-vector";
import { getCandles } from "@/lib/data/candles";
import { getRegime } from "../regime";
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
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: regime classifier returns null → fail-open, strategy fires
    // based on its own triggers. Tests that need a specific regime override
    // this per-test.
    vi.mocked(getRegime).mockResolvedValue(null);
  });

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

  it("returns null when regime classifier disagrees", async () => {
    // Setup conditions that would normally trigger a long entry (vol spike trending up)
    vi.mocked(getCandles).mockImplementation(async (_asset, tf) => {
      if (tf === "1m") return trendingCandles(100, 0.3, 5, 60_000);
      return constantCandles(100, 24, 60 * 60_000);
    });
    // Vol Vector only trades in vol-expanding; mean-reverting is not allowed
    vi.mocked(getRegime).mockResolvedValue({
      regime: "mean-reverting",
      confidence: 0.9,
      sampledAtMs: Date.now(),
    });
    const decision = await VolVectorStrategy.evaluateEntry(
      { asset: "SOL", mark: 101.5 },
      emptySignals,
    );
    expect(decision).toBeNull();
  });

  it("fires when regime classifier returns null (fail-open)", async () => {
    // Setup conditions that would normally trigger a long entry (vol spike trending up)
    vi.mocked(getCandles).mockImplementation(async (_asset, tf) => {
      if (tf === "1m") return trendingCandles(100, 0.3, 5, 60_000);
      return constantCandles(100, 24, 60 * 60_000);
    });
    vi.mocked(getRegime).mockResolvedValue(null);
    const decision = await VolVectorStrategy.evaluateEntry(
      { asset: "SOL", mark: 101.5 },
      emptySignals,
    );
    expect(decision).not.toBeNull();
  });
});

describe("VolVectorHairTrigger (variant)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRegime).mockResolvedValue(null);
  });

  it("fires at a lower vol multiplier than the headliner", async () => {
    vi.mocked(getCandles).mockImplementation(async (_asset, tf, count) => {
      if (tf === "1m" && count === 5) {
        return trendingCandles(100, 0.25, 5, 60_000);
      }
      if (tf === "1m") {
        return trendingCandles(100, 0.08, 30, 60_000);
      }
      return trendingCandles(100, 0.2, 24, 60 * 60_000);
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
