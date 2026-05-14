// lib/bots/strategies/mean-revert-mike.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/data/candles", () => ({
  getCandles: vi.fn(),
}));

import { MeanRevertMikeStrategy, MeanRevertMikePatientStrategy } from "./mean-revert-mike";
import { getCandles } from "@/lib/data/candles";
import type { MarketContext, ExternalSignals, PaperPosition } from "../types";

const baseCtx: MarketContext = { asset: "SOL", mark: 100 };
const emptySignals: ExternalSignals = { liquidations: [], funding: {} };

function buildCandles(baselineCloses: number[], finalClose: number) {
  return [...baselineCloses, finalClose].map((c, i) => ({
    ts: 1_000 + i * 60_000,
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 1,
  }));
}

describe("MeanRevertMike.evaluateEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when candles fetch returns empty", async () => {
    vi.mocked(getCandles).mockResolvedValue([]);
    const decision = await MeanRevertMikeStrategy.evaluateEntry(baseCtx, emptySignals);
    expect(decision).toBeNull();
  });

  it("shorts when z-score is well above the threshold (overextended)", async () => {
    const baseline = Array(29).fill(100);
    vi.mocked(getCandles).mockResolvedValue(buildCandles(baseline, 110));
    const decision = await MeanRevertMikeStrategy.evaluateEntry(
      { asset: "SOL", mark: 110 },
      emptySignals,
    );
    expect(decision).not.toBeNull();
    expect(decision!.side).toBe("short");
  });

  it("longs when z-score is well below the threshold (oversold)", async () => {
    const baseline = Array(29).fill(100);
    vi.mocked(getCandles).mockResolvedValue(buildCandles(baseline, 90));
    const decision = await MeanRevertMikeStrategy.evaluateEntry(
      { asset: "SOL", mark: 90 },
      emptySignals,
    );
    expect(decision).not.toBeNull();
    expect(decision!.side).toBe("long");
  });

  it("returns null when the move is within normal range (z-score < 2.5)", async () => {
    const baseline = Array(15).fill(100).concat(Array(14).fill(105));
    vi.mocked(getCandles).mockResolvedValue(buildCandles(baseline, 103));
    const decision = await MeanRevertMikeStrategy.evaluateEntry(
      { asset: "SOL", mark: 103 },
      emptySignals,
    );
    expect(decision).toBeNull();
  });
});

describe("MeanRevertMike.evaluateExit", () => {
  const openShort: PaperPosition = {
    id: "p1",
    botId: "mean-revert-mike",
    asset: "SOL",
    side: "short",
    leverage: 25,
    stakeUsd: 100,
    entryMark: 110,
    entryTs: new Date(),
    exitMark: null,
    exitTs: null,
    paperPnlUsd: null,
    triggerMeta: null,
    narrationOpen: null,
    narrationClose: null,
    status: "open",
  };

  it("exits on a favorable 0.6% reversion", () => {
    expect(
      MeanRevertMikeStrategy.evaluateExit(
        { asset: "SOL", mark: 109.3 },
        openShort,
      ),
    ).toBe(true);
  });

  it("exits after 30min max hold", () => {
    const old: PaperPosition = {
      ...openShort,
      entryTs: new Date(Date.now() - 35 * 60 * 1000),
    };
    expect(
      MeanRevertMikeStrategy.evaluateExit(
        { asset: "SOL", mark: 110 },
        old,
      ),
    ).toBe(true);
  });
});
