import { describe, expect, it } from "vitest";
import type { PulseItem } from "./pulse-items";
import {
  buildPulseSeedComments,
  buildPulseSocialStats,
  PULSE_REACTIONS,
} from "./pulse-social";

const item: PulseItem = {
  id: "pos-1:deep_profit",
  kind: "deep_profit",
  score: 250,
  eyebrow: "Deep in profit",
  headline: "BTC long is already up 58.0%",
  context: "Tailing now means entering after part of the whale's move.",
  reactionSeed: 3_944_204_321,
  canTail: true,
  position: {
    positionId: "pos-1",
    whaleId: "hyperliquid:0xabc",
    source: "hyperliquid",
    sourceAccount: "0xabc",
    displayName: "HL 0xabc",
    avatarUrl: null,
    market: "BTC",
    side: "long",
    leverage: 40,
    amountBase: 1,
    notionalUsd: 1_000_000,
    entryPrice: 70_000,
    currentMark: 77_000,
    unrealizedPnlPct: 400,
    openedAtMs: 1_779_560_000_000,
    lastSeenAtMs: 1_779_620_000_000,
    stale: false,
    copyableOnPacifica: true,
    analysis: null,
  },
};

describe("Pulse social helpers", () => {
  it("uses tailing, bullish, and bearish as the primary reaction set", () => {
    expect(PULSE_REACTIONS).toEqual(["Tailing", "Bullish", "Bearish"]);
  });

  it("builds stable social counts including comments", () => {
    const first = buildPulseSocialStats(item);
    const second = buildPulseSocialStats(item);

    expect(first).toEqual(second);
    expect(first.Tailing).toBeGreaterThan(0);
    expect(first.Bullish).toBeGreaterThan(0);
    expect(first.Bearish).toBeGreaterThan(0);
    expect(first.Comments).toBeGreaterThan(0);
  });

  it("seeds comments with position-specific copy", () => {
    const comments = buildPulseSeedComments(item);

    expect(comments.length).toBeGreaterThanOrEqual(2);
    expect(comments[0]?.body).toContain("BTC");
    expect(comments.some((comment) => comment.body.includes("tail"))).toBe(true);
  });
});
