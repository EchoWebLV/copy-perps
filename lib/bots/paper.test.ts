import { describe, it, expect } from "vitest";
import { computePaperPnlUsd, computeLivePaperPnlPct } from "./paper";

describe("computePaperPnlUsd", () => {
  it("long 10x with 10% price move returns +stake * leverage", () => {
    // $100 stake, 10x leverage = $1000 notional, +10% move = +$100 pnl
    expect(
      computePaperPnlUsd({
        side: "long",
        leverage: 10,
        entryMark: 100,
        exitMark: 110,
        notionalUsd: 1000,
      }),
    ).toBeCloseTo(100, 4);
  });

  it("short 5x with 10% price drop returns +stake * leverage", () => {
    expect(
      computePaperPnlUsd({
        side: "short",
        leverage: 5,
        entryMark: 100,
        exitMark: 90,
        notionalUsd: 500,
      }),
    ).toBeCloseTo(50, 4);
  });

  it("long with adverse move returns negative", () => {
    expect(
      computePaperPnlUsd({
        side: "long",
        leverage: 10,
        entryMark: 100,
        exitMark: 95,
        notionalUsd: 1000,
      }),
    ).toBeCloseTo(-50, 4);
  });
});

describe("computeLivePaperPnlPct", () => {
  it("matches the closed PnL when called with the live mark", () => {
    const pct = computeLivePaperPnlPct({
      side: "long",
      leverage: 10,
      entryMark: 100,
      currentMark: 105,
    });
    // 5% move × 10x = 50% PnL on stake
    expect(pct).toBeCloseTo(0.5, 4);
  });
});
