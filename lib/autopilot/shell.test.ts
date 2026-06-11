import { describe, expect, it } from "vitest";
import type { BrainDecision } from "./brain";
import {
  evaluateShell,
  isTiltCooldown,
  lossBudgetRemaining,
  sessionPhase,
  type RecentClose,
} from "./shell";

const NOW = new Date("2026-06-11T12:00:00Z");

const decision: BrainDecision = {
  side: "long",
  conviction: 0.8,
  reason: "test",
};

function minsAgo(mins: number): Date {
  return new Date(NOW.getTime() - mins * 60_000);
}

describe("lossBudgetRemaining / sessionPhase", () => {
  it("losses eat the budget; profits do not extend it", () => {
    expect(lossBudgetRemaining({ budgetUsd: 100, realizedPnlUsd: -30, tier: "cruise" })).toBe(70);
    expect(lossBudgetRemaining({ budgetUsd: 100, realizedPnlUsd: 50, tier: "cruise" })).toBe(100);
  });

  it("phases: active / exhausted / target", () => {
    expect(sessionPhase({ budgetUsd: 100, realizedPnlUsd: 0, tier: "cruise" })).toBe("active");
    expect(sessionPhase({ budgetUsd: 100, realizedPnlUsd: -100, tier: "cruise" })).toBe("exhausted");
    expect(sessionPhase({ budgetUsd: 100, realizedPnlUsd: -150, tier: "cruise" })).toBe("exhausted");
    expect(sessionPhase({ budgetUsd: 100, realizedPnlUsd: 100, tier: "cruise" })).toBe("target");
    expect(sessionPhase({ budgetUsd: 100, realizedPnlUsd: 150, tier: "cruise" })).toBe("target");
  });
});

describe("isTiltCooldown", () => {
  it("is order-independent (oldest-first input still trips the guard)", () => {
    const closes = [
      { pnlUsd: -1, closedAt: new Date(NOW.getTime() - 4 * 60 * 1000) },
      { pnlUsd: -1, closedAt: new Date(NOW.getTime() - 60 * 1000) },
    ];
    expect(isTiltCooldown(closes, NOW)).toBe(true);
  });


  it("two fresh consecutive losses trip the cooldown", () => {
    const closes: RecentClose[] = [
      { pnlUsd: -2, closedAt: minsAgo(1) },
      { pnlUsd: -1, closedAt: minsAgo(3) },
    ];
    expect(isTiltCooldown(closes, NOW)).toBe(true);
  });

  it("a green close clears it", () => {
    const closes: RecentClose[] = [
      { pnlUsd: 1, closedAt: minsAgo(1) },
      { pnlUsd: -2, closedAt: minsAgo(2) },
    ];
    expect(isTiltCooldown(closes, NOW)).toBe(false);
  });

  it("stale losses do not trip it (window anchors to the newest close)", () => {
    const closes: RecentClose[] = [
      { pnlUsd: -2, closedAt: minsAgo(10) },
      { pnlUsd: -1, closedAt: minsAgo(12) },
    ];
    expect(isTiltCooldown(closes, NOW)).toBe(false);
  });

  it("fewer than two closes never trips it", () => {
    expect(isTiltCooldown([{ pnlUsd: -5, closedAt: minsAgo(1) }], NOW)).toBe(false);
    expect(isTiltCooldown([], NOW)).toBe(false);
  });
});

describe("evaluateShell", () => {
  it("reserves open stakes against the budget (no concurrent overshoot)", () => {
    // Budget $100, realized -$98.50 -> remaining $1.50. One open $1 stake
    // reserved -> only $0.50 deployable -> second open must be denied.
    const verdict = evaluateShell({
      session: { budgetUsd: 100, realizedPnlUsd: -98.5, tier: "cruise" },
      openCount: 1,
      openStakesUsd: 1,
      recentCloses: [],
      decision,
      now: NOW,
    });
    expect(verdict.allow).toBe(false);
  });


  const base = {
    openStakesUsd: 0,
    session: { budgetUsd: 100, realizedPnlUsd: 0, tier: "cruise" as const },
    openCount: 0,
    recentCloses: [] as RecentClose[],
    decision,
    now: NOW,
  };

  it("approves with tier-decided money parameters", () => {
    const verdict = evaluateShell(base);
    expect(verdict).toEqual({
      allow: true,
      stakeUsdc: 10,
      leverage: 50,
      mode: "standard",
      slRoiPct: -50,
      tpRoiPct: 100,
      maxHoldMin: 90,
    });
  });

  it("denies when concurrency is maxed", () => {
    const verdict = evaluateShell({ ...base, openCount: 2 });
    expect(verdict.allow).toBe(false);
  });

  it("denies during tilt cooldown", () => {
    const verdict = evaluateShell({
      ...base,
      recentCloses: [
        { pnlUsd: -2, closedAt: minsAgo(1) },
        { pnlUsd: -1, closedAt: minsAgo(2) },
      ],
    });
    expect(verdict.allow).toBe(false);
  });

  it("denies when the loss budget cannot fund a stake", () => {
    const verdict = evaluateShell({
      ...base,
      session: { budgetUsd: 100, realizedPnlUsd: -99.5, tier: "cruise" },
    });
    expect(verdict.allow).toBe(false);
  });

  it("denies (and reports phase) when exhausted or at target", () => {
    expect(
      evaluateShell({
        ...base,
        session: { budgetUsd: 100, realizedPnlUsd: -100, tier: "cruise" },
      }).allow,
    ).toBe(false);
    expect(
      evaluateShell({
        ...base,
        session: { budgetUsd: 100, realizedPnlUsd: 120, tier: "cruise" },
      }).allow,
    ).toBe(false);
  });

  it("degen tier: hard $10 cap, 500x, degen mode, TP +150", () => {
    const verdict = evaluateShell({
      ...base,
      session: { budgetUsd: 200, realizedPnlUsd: 0, tier: "degen" },
    });
    expect(verdict).toEqual({
      allow: true,
      stakeUsdc: 10,
      leverage: 500,
      mode: "degen",
      slRoiPct: -50,
      tpRoiPct: 150,
      maxHoldMin: 15,
    });
  });
});
