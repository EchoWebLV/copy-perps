import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));

import { computeMoodBadge, type MoodBadge } from "./mood";
import type { PaperPosition } from "./types";

function pos(over: Partial<PaperPosition>): PaperPosition {
  return {
    id: "p1",
    botId: "bot",
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
    ...over,
  };
}

describe("computeMoodBadge", () => {
  it("returns BUSTED when bot.status is busted", () => {
    const badge = computeMoodBadge({
      botStatus: "busted",
      balanceUsd: 0,
      startingBalanceUsd: 1000,
      openPositions: [],
      recentClosedPnls: [],
    });
    expect(badge).toBe("BUSTED" satisfies MoodBadge);
  });

  it("returns ON_STREAK when last 3 closed pnls are all positive", () => {
    const badge = computeMoodBadge({
      botStatus: "paper",
      balanceUsd: 1100,
      startingBalanceUsd: 1000,
      openPositions: [],
      recentClosedPnls: [10, 20, 30],
    });
    expect(badge).toBe("ON_STREAK");
  });

  it("returns WOUNDED when an open position is at <= -25% on stake", () => {
    const badge = computeMoodBadge({
      botStatus: "paper",
      balanceUsd: 1000,
      startingBalanceUsd: 1000,
      openPositions: [pos({ stakeUsd: 100 })],
      // Note: WOUNDED is decided by livePaperPnlPct in args (see API).
      livePnlPctByPositionId: { p1: -0.3 },
      recentClosedPnls: [],
    });
    expect(badge).toBe("WOUNDED");
  });

  it("returns LOADED when bot has an open position with non-negative live PnL", () => {
    const badge = computeMoodBadge({
      botStatus: "paper",
      balanceUsd: 1000,
      startingBalanceUsd: 1000,
      openPositions: [pos({ stakeUsd: 100 })],
      livePnlPctByPositionId: { p1: 0.02 },
      recentClosedPnls: [],
    });
    expect(badge).toBe("LOADED");
  });

  it("returns DORMANT for an inactive bot with no open positions", () => {
    const badge = computeMoodBadge({
      botStatus: "paper",
      balanceUsd: 950,
      startingBalanceUsd: 1000,
      openPositions: [],
      recentClosedPnls: [],
    });
    expect(badge).toBe("DORMANT");
  });

  it("returns HUNTING when hasNearSignal is true and bot has no positions", () => {
    const badge = computeMoodBadge({
      botStatus: "paper",
      balanceUsd: 1000,
      startingBalanceUsd: 1000,
      openPositions: [],
      recentClosedPnls: [],
      hasNearSignal: true,
    });
    expect(badge).toBe("HUNTING");
  });

  it("prefers WOUNDED over LOADED when one position is wounded and another is up", () => {
    const badge = computeMoodBadge({
      botStatus: "paper",
      balanceUsd: 1000,
      startingBalanceUsd: 1000,
      openPositions: [
        pos({ id: "a", stakeUsd: 100 }),
        pos({ id: "b", stakeUsd: 100 }),
      ],
      livePnlPctByPositionId: { a: -0.3, b: 0.05 },
      recentClosedPnls: [],
    });
    expect(badge).toBe("WOUNDED");
  });
});
