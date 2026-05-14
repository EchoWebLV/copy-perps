import { describe, it, expect, vi } from "vitest";

// paper.ts appends DB helpers which import @/lib/db — mock it so pure math
// tests don't need a DATABASE_URL.
vi.mock("@/lib/db", () => ({ db: {} }));

import { computePaperPnlUsd, computeLivePaperPnlPct } from "./paper";

describe("computePaperPnlUsd", () => {
  it("long 10x with 10% price move returns stake * leverage * move", () => {
    // $100 stake, 10x leverage, +10% move → 100 × 10 × 0.10 = +$100 pnl
    expect(
      computePaperPnlUsd({
        side: "long",
        leverage: 10,
        entryMark: 100,
        exitMark: 110,
        stakeUsd: 100,
      }),
    ).toBeCloseTo(100, 4);
  });

  it("short 5x with 10% price drop returns stake * leverage * move", () => {
    // $100 stake, 5x leverage, -10% move (short profit) → 100 × 5 × 0.10 = +$50
    expect(
      computePaperPnlUsd({
        side: "short",
        leverage: 5,
        entryMark: 100,
        exitMark: 90,
        stakeUsd: 100,
      }),
    ).toBeCloseTo(50, 4);
  });

  it("long with adverse move returns negative", () => {
    // $100 stake, 10x leverage, -5% move → 100 × 10 × -0.05 = -$50
    expect(
      computePaperPnlUsd({
        side: "long",
        leverage: 10,
        entryMark: 100,
        exitMark: 95,
        stakeUsd: 100,
      }),
    ).toBeCloseTo(-50, 4);
  });

  it("leverage scales the PnL — 50x earns 10x what 5x earns on same stake + move", () => {
    // Same stake, same 0.5% move, different leverage. This is the critical
    // cross-bot-comparability test: a 50x bot's reward per move should be
    // 10x a 5x bot's, otherwise the leaderboard ranks them identically.
    const args = {
      side: "long" as const,
      entryMark: 100,
      exitMark: 100.5,
      stakeUsd: 100,
    };
    const pnl50x = computePaperPnlUsd({ ...args, leverage: 50 });
    const pnl5x = computePaperPnlUsd({ ...args, leverage: 5 });
    expect(pnl50x).toBeCloseTo(25, 4); // 100 × 50 × 0.005
    expect(pnl5x).toBeCloseTo(2.5, 4); // 100 × 5 × 0.005
    expect(pnl50x / pnl5x).toBeCloseTo(10, 4);
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

  it("is consistent with computePaperPnlUsd — live% × stake = closed$", () => {
    // Same trade, two ways of expressing it. The display layer relies on
    // these matching: live card shows "+25%", close commits "+$25" for $100
    // stake at 50x with +0.5% move.
    const livePct = computeLivePaperPnlPct({
      side: "long",
      leverage: 50,
      entryMark: 100,
      currentMark: 100.5,
    });
    const closedUsd = computePaperPnlUsd({
      side: "long",
      leverage: 50,
      entryMark: 100,
      exitMark: 100.5,
      stakeUsd: 100,
    });
    expect(closedUsd).toBeCloseTo(livePct * 100, 4); // closed$ = live% × stake
  });
});
