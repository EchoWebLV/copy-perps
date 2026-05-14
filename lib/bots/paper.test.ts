import { describe, it, expect, vi } from "vitest";

// paper.ts appends DB helpers which import @/lib/db — mock it so pure math
// tests don't need a DATABASE_URL.
vi.mock("@/lib/db", () => ({ db: {} }));

import { computePaperPnlUsd, computeLivePaperPnlPct } from "./paper";
import { applyExitSlippage, roundTripFeesUsd, TAKER_FEE_BPS } from "./fees";

// Both entryMark and exitMark passed to computePaperPnlUsd are FILL prices
// (the resolver writes the slipped fills). So these tests fix entry/exit to
// specific fill values and assert the (move × notional) − round-trip fees.

describe("computePaperPnlUsd", () => {
  it("long 10x +10% move nets gross minus round-trip fees", () => {
    // Gross: 100 × 10 × 0.10 = $100. Fees: 100 × 10 × (4bps × 2) = $0.80.
    expect(
      computePaperPnlUsd({
        side: "long",
        leverage: 10,
        entryMark: 100,
        exitMark: 110,
        stakeUsd: 100,
      }),
    ).toBeCloseTo(100 - roundTripFeesUsd(100, 10), 4);
  });

  it("short 5x -10% move nets gross minus round-trip fees", () => {
    // Gross: 100 × 5 × 0.10 = $50. Fees: 100 × 5 × (4bps × 2) = $0.40.
    expect(
      computePaperPnlUsd({
        side: "short",
        leverage: 5,
        entryMark: 100,
        exitMark: 90,
        stakeUsd: 100,
      }),
    ).toBeCloseTo(50 - roundTripFeesUsd(100, 5), 4);
  });

  it("long with adverse move stays negative AND fees deepen the loss", () => {
    // Gross: -$50. Fees still cost $0.80 → net -$50.80.
    const pnl = computePaperPnlUsd({
      side: "long",
      leverage: 10,
      entryMark: 100,
      exitMark: 95,
      stakeUsd: 100,
    });
    expect(pnl).toBeLessThan(-50);
    expect(pnl).toBeCloseTo(-50 - roundTripFeesUsd(100, 10), 4);
  });

  it("a tiny price move can be net-NEGATIVE because of fee drag", () => {
    // 0.05% move at 5x = +0.25% on stake gross. Fees at 5x = 0.40% on stake.
    // Bot "wins" the direction but loses the cycle.
    const pnl = computePaperPnlUsd({
      side: "long",
      leverage: 5,
      entryMark: 100,
      exitMark: 100.05,
      stakeUsd: 100,
    });
    expect(pnl).toBeLessThan(0);
  });

  it("leverage scales fees and PnL together — net ratio still proportional", () => {
    const args = {
      side: "long" as const,
      entryMark: 100,
      exitMark: 100.5,
      stakeUsd: 100,
    };
    const pnl50x = computePaperPnlUsd({ ...args, leverage: 50 });
    const pnl5x = computePaperPnlUsd({ ...args, leverage: 5 });
    // Gross: 50x → $25, 5x → $2.5. Fees: 50x → $4, 5x → $0.40. Net 21 / 2.1.
    expect(pnl50x).toBeCloseTo(25 - roundTripFeesUsd(100, 50), 4);
    expect(pnl5x).toBeCloseTo(2.5 - roundTripFeesUsd(100, 5), 4);
    expect(pnl50x / pnl5x).toBeCloseTo(10, 4);
  });
});

describe("computeLivePaperPnlPct", () => {
  it("includes hypothetical exit slippage + fees in the displayed pct", () => {
    // Long SOL (4 bps slip), 10x, entry 100 fill, mid 105.
    // Exit fill = 105 × (1 − 0.0004) = 104.958.
    // Gross: $100 × 10 × (104.958 − 100) / 100 = $49.58.
    // Fees: 100 × 10 × 0.0008 = $0.80. Net: $48.78 → 48.78% on $100 stake.
    const pct = computeLivePaperPnlPct({
      side: "long",
      leverage: 10,
      entryMark: 100,
      currentMark: 105,
      asset: "SOL",
      stakeUsd: 100,
    });
    const expectedExit = applyExitSlippage(105, "long", "SOL");
    const expectedNet =
      (100 * 10 * (expectedExit - 100)) / 100 - roundTripFeesUsd(100, 10);
    expect(pct).toBeCloseTo(expectedNet / 100, 4);
  });

  it("live% × stake equals computePaperPnlUsd called with the slipped fill", () => {
    // Display invariant: the live percentage shown on the card must equal,
    // when multiplied by stake, the realized PnL the bot would book if it
    // closed at this mid right now (slippage + fees included).
    const args = {
      side: "long" as const,
      leverage: 50,
      entryMark: 100,
      currentMark: 100.5,
      asset: "SOL",
      stakeUsd: 100,
    };
    const livePct = computeLivePaperPnlPct(args);
    const closedUsd = computePaperPnlUsd({
      side: args.side,
      leverage: args.leverage,
      entryMark: args.entryMark,
      exitMark: applyExitSlippage(args.currentMark, args.side, args.asset),
      stakeUsd: args.stakeUsd,
    });
    expect(closedUsd).toBeCloseTo(livePct * args.stakeUsd, 4);
  });

  it("zero stake returns zero pct (defensive)", () => {
    expect(
      computeLivePaperPnlPct({
        side: "long",
        leverage: 10,
        entryMark: 100,
        currentMark: 110,
        asset: "BTC",
        stakeUsd: 0,
      }),
    ).toBe(0);
  });

  it("thin asset (HYPE) eats more bps than a major (BTC) on the same move", () => {
    const hypePct = computeLivePaperPnlPct({
      side: "long",
      leverage: 20,
      entryMark: 100,
      currentMark: 100.5,
      asset: "HYPE",
      stakeUsd: 100,
    });
    const btcPct = computeLivePaperPnlPct({
      side: "long",
      leverage: 20,
      entryMark: 100,
      currentMark: 100.5,
      asset: "BTC",
      stakeUsd: 100,
    });
    expect(btcPct).toBeGreaterThan(hypePct);
  });
});

describe("fee constants stay public", () => {
  it("TAKER_FEE_BPS is a positive number under 50 bps (sanity)", () => {
    expect(TAKER_FEE_BPS).toBeGreaterThan(0);
    expect(TAKER_FEE_BPS).toBeLessThan(50);
  });
});
