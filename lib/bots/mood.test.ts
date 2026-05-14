import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));

import { computeMoodBadge, type MoodBadge } from "./mood";

describe("computeMoodBadge", () => {
  it("returns BUSTED when bot.status is busted", () => {
    const badge = computeMoodBadge({
      botStatus: "busted",
      openPositions: [],
      recentClosedPnls: [],
    });
    expect(badge).toBe("BUSTED" satisfies MoodBadge);
  });

  it("returns ON_STREAK when last 3 closed pnls are all positive", () => {
    const badge = computeMoodBadge({
      botStatus: "paper",
      openPositions: [],
      recentClosedPnls: [10, 20, 30],
    });
    expect(badge).toBe("ON_STREAK");
  });

  it("returns WOUNDED when an open position is at <= -25% on stake", () => {
    const badge = computeMoodBadge({
      botStatus: "paper",
      openPositions: [{ id: "p1" }],
      // Note: WOUNDED is decided by livePaperPnlPct in args (see API).
      livePnlPctByPositionId: { p1: -0.3 },
      recentClosedPnls: [],
    });
    expect(badge).toBe("WOUNDED");
  });

  it("returns LOADED when bot has an open position with non-negative live PnL", () => {
    const badge = computeMoodBadge({
      botStatus: "paper",
      openPositions: [{ id: "p1" }],
      livePnlPctByPositionId: { p1: 0.02 },
      recentClosedPnls: [],
    });
    expect(badge).toBe("LOADED");
  });

  it("returns DORMANT for an inactive bot with no open positions", () => {
    const badge = computeMoodBadge({
      botStatus: "paper",
      openPositions: [],
      recentClosedPnls: [],
    });
    expect(badge).toBe("DORMANT");
  });

  it("returns HUNTING when hasNearSignal is true and bot has no positions", () => {
    const badge = computeMoodBadge({
      botStatus: "paper",
      openPositions: [],
      recentClosedPnls: [],
      hasNearSignal: true,
    });
    expect(badge).toBe("HUNTING");
  });

  it("prefers WOUNDED over LOADED when one position is wounded and another is up", () => {
    const badge = computeMoodBadge({
      botStatus: "paper",
      openPositions: [{ id: "a" }, { id: "b" }],
      livePnlPctByPositionId: { a: -0.3, b: 0.05 },
      recentClosedPnls: [],
    });
    expect(badge).toBe("WOUNDED");
  });
});
