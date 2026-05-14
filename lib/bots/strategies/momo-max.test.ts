// lib/bots/strategies/momo-max.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/data/candles", () => ({
  getCandles: vi.fn(),
}));
vi.mock("../regime", () => ({
  getRegime: vi.fn(),
}));

import { MomoMaxStrategy, MomoMaxAggressiveStrategy } from "./momo-max";
import { getCandles } from "@/lib/data/candles";
import { getRegime } from "../regime";
import type { MarketContext, ExternalSignals, PaperPosition } from "../types";

const baseCtx: MarketContext = { asset: "SOL", mark: 100 };
const emptySignals: ExternalSignals = { liquidations: [], funding: {} };

function flatCandles(close: number, volume: number, n: number) {
  return Array.from({ length: n }, (_, i) => ({
    ts: 1_000 + i * 5 * 60_000,
    open: close,
    high: close,
    low: close,
    close,
    volume,
  }));
}

describe("MomoMax.evaluateEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: regime classifier returns null → fail-open, strategy fires
    // based on its own triggers. Tests that need a specific regime override
    // this per-test.
    vi.mocked(getRegime).mockResolvedValue(null);
  });

  it("returns null on flat candles", async () => {
    vi.mocked(getCandles).mockResolvedValue(flatCandles(100, 5, 12));
    const decision = await MomoMaxStrategy.evaluateEntry(baseCtx, emptySignals);
    expect(decision).toBeNull();
  });

  it("longs on a >1% upward breakout with volume spike", async () => {
    const candles = flatCandles(100, 5, 11);
    candles.push({
      ts: 1_000 + 11 * 5 * 60_000,
      open: 100,
      high: 102,
      low: 100,
      close: 101.5,
      volume: 12,
    });
    vi.mocked(getCandles).mockResolvedValue(candles);
    const decision = await MomoMaxStrategy.evaluateEntry(
      { asset: "SOL", mark: 101.5 },
      emptySignals,
    );
    expect(decision).not.toBeNull();
    expect(decision!.side).toBe("long");
  });

  it("returns null when volume is below the multiplier threshold", async () => {
    const candles = flatCandles(100, 5, 11);
    candles.push({
      ts: 1_000 + 11 * 5 * 60_000,
      open: 100,
      high: 102,
      low: 100,
      close: 101.5,
      volume: 4,
    });
    vi.mocked(getCandles).mockResolvedValue(candles);
    const decision = await MomoMaxStrategy.evaluateEntry(
      { asset: "SOL", mark: 101.5 },
      emptySignals,
    );
    expect(decision).toBeNull();
  });

  it("shorts on a >1% downward breakout with volume spike", async () => {
    const candles = flatCandles(100, 5, 11);
    candles.push({
      ts: 1_000 + 11 * 5 * 60_000,
      open: 100,
      high: 100,
      low: 98,
      close: 98.5,
      volume: 12,
    });
    vi.mocked(getCandles).mockResolvedValue(candles);
    const decision = await MomoMaxStrategy.evaluateEntry(
      { asset: "SOL", mark: 98.5 },
      emptySignals,
    );
    expect(decision).not.toBeNull();
    expect(decision!.side).toBe("short");
  });

  it("returns null when regime classifier disagrees", async () => {
    // Setup conditions that would normally trigger a long entry
    const candles = flatCandles(100, 5, 11);
    candles.push({
      ts: 1_000 + 11 * 5 * 60_000,
      open: 100,
      high: 102,
      low: 100,
      close: 101.5,
      volume: 12,
    });
    vi.mocked(getCandles).mockResolvedValue(candles);
    // Momo Max doesn't trade in mean-reverting
    vi.mocked(getRegime).mockResolvedValue({
      regime: "mean-reverting",
      confidence: 0.9,
      sampledAtMs: Date.now(),
    });
    const decision = await MomoMaxStrategy.evaluateEntry(
      { asset: "SOL", mark: 101.5 },
      emptySignals,
    );
    expect(decision).toBeNull();
  });

  it("fires when regime classifier returns null (fail-open)", async () => {
    // Setup conditions that would normally trigger a long entry
    const candles = flatCandles(100, 5, 11);
    candles.push({
      ts: 1_000 + 11 * 5 * 60_000,
      open: 100,
      high: 102,
      low: 100,
      close: 101.5,
      volume: 12,
    });
    vi.mocked(getCandles).mockResolvedValue(candles);
    vi.mocked(getRegime).mockResolvedValue(null);
    const decision = await MomoMaxStrategy.evaluateEntry(
      { asset: "SOL", mark: 101.5 },
      emptySignals,
    );
    expect(decision).not.toBeNull();
  });
});

describe("MomoMaxAggressive (variant)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRegime).mockResolvedValue(null);
  });

  it("fires at a lower breakout threshold (0.5%) than headliner (1%)", async () => {
    const candles = flatCandles(100, 5, 11);
    candles.push({
      ts: 1_000 + 11 * 5 * 60_000,
      open: 100,
      high: 100.8,
      low: 100,
      close: 100.7,
      volume: 12,
    });
    vi.mocked(getCandles).mockResolvedValue(candles);
    const headliner = await MomoMaxStrategy.evaluateEntry(
      { asset: "SOL", mark: 100.7 },
      emptySignals,
    );
    const aggressive = await MomoMaxAggressiveStrategy.evaluateEntry(
      { asset: "SOL", mark: 100.7 },
      emptySignals,
    );
    expect(headliner).toBeNull();
    expect(aggressive).not.toBeNull();
  });
});

describe("MomoMax.evaluateExit", () => {
  const openLong: PaperPosition = {
    id: "p1",
    botId: "momo-max",
    asset: "SOL",
    side: "long",
    leverage: 20,
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

  it("exits on 0.5% favorable move", () => {
    expect(
      MomoMaxStrategy.evaluateExit({ asset: "SOL", mark: 100.5 }, openLong),
    ).toBe(true);
  });

  it("exits after 30min max hold", () => {
    const old: PaperPosition = {
      ...openLong,
      entryTs: new Date(Date.now() - 35 * 60 * 1000),
    };
    expect(
      MomoMaxStrategy.evaluateExit({ asset: "SOL", mark: 100 }, old),
    ).toBe(true);
  });
});
