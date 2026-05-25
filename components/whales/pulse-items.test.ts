import { describe, expect, it } from "vitest";
import type { WhalePositionSignal } from "@/lib/types";
import { buildPulseItems } from "./pulse-items";

const NOW = 1_779_626_500_000;

function position(
  overrides: Partial<WhalePositionSignal["payload"]> = {},
): WhalePositionSignal {
  const payload: WhalePositionSignal["payload"] = {
    positionId: overrides.positionId ?? "pos-1",
    whaleId: overrides.whaleId ?? "hyperliquid:0xabc",
    source: overrides.source ?? "hyperliquid",
    sourceAccount: overrides.sourceAccount ?? "0xabc",
    displayName: overrides.displayName ?? "lateBdoer",
    avatarUrl: overrides.avatarUrl ?? null,
    market: overrides.market ?? "BTC",
    side: overrides.side ?? "long",
    leverage: overrides.leverage ?? 10,
    amountBase: overrides.amountBase ?? 1,
    notionalUsd: overrides.notionalUsd ?? 100_000,
    entryPrice: overrides.entryPrice ?? 70_000,
    currentMark: overrides.currentMark ?? 70_700,
    unrealizedPnlPct: overrides.unrealizedPnlPct ?? 10,
    openedAtMs: overrides.openedAtMs ?? NOW - 5 * 60_000,
    lastSeenAtMs: overrides.lastSeenAtMs ?? NOW - 30_000,
    stale: overrides.stale ?? false,
    copyableOnPacifica: overrides.copyableOnPacifica ?? true,
    analysis: overrides.analysis ?? null,
  };

  return {
    id: `whale_position:${payload.positionId}`,
    type: "whale_position",
    heatScore: 100,
    createdAt: new Date(NOW).toISOString(),
    chips: [],
    payload,
  };
}

describe("buildPulseItems", () => {
  it("creates social tape item variants from live whale positions", () => {
    const items = buildPulseItems(
      [
        position({ positionId: "fresh", openedAtMs: NOW - 2 * 60_000 }),
        position({ positionId: "big", notionalUsd: 1_200_000 }),
        position({ positionId: "profit", unrealizedPnlPct: 58 }),
        position({ positionId: "pain", unrealizedPnlPct: -18 }),
        position({
          positionId: "gap",
          analysis: {
            summary: "summary",
            thesis: "thesis",
            risk: "risk",
            entryGapWarning:
              "Current mark is 12.4% above the whale entry. Followers enter at the live price, not the whale entry.",
            confidence: 0.4,
          },
        }),
      ],
      NOW,
    );

    expect(items.map((item) => item.kind)).toContain("fresh_open");
    expect(items.map((item) => item.kind)).toContain("big_position");
    expect(items.map((item) => item.kind)).toContain("deep_profit");
    expect(items.map((item) => item.kind)).toContain("pain_trade");
    expect(items.map((item) => item.kind)).toContain("entry_gap");
  });

  it("uses performance-led headlines when live P&L is available", () => {
    const items = buildPulseItems(
      [
        position({
          positionId: "eth-short",
          market: "ETH",
          side: "short",
          notionalUsd: 1_200_000,
          unrealizedPnlPct: 162.6,
          analysis: {
            summary: "summary",
            thesis: "thesis",
            risk: "risk",
            entryGapWarning:
              "Current mark is 12.4% below the whale entry. Followers enter at the live price, not the whale entry.",
            confidence: 0.4,
          },
        }),
      ],
      NOW,
    );

    expect(items.length).toBeGreaterThan(1);
    expect(new Set(items.map((item) => item.headline))).toEqual(
      new Set(["ETH short is already up 162.6%"]),
    );
  });

  it("uses down-performance headlines for losing positions", () => {
    const items = buildPulseItems(
      [
        position({
          positionId: "sol-long",
          market: "SOL",
          side: "long",
          unrealizedPnlPct: -18,
        }),
      ],
      NOW,
    );

    expect(items.find((item) => item.kind === "pain_trade")?.headline).toBe(
      "SOL long is already down 18.0%",
    );
  });

  it("sorts items by descending pulse score", () => {
    const items = buildPulseItems(
      [
        position({ positionId: "small", notionalUsd: 80_000, openedAtMs: NOW - 50 * 60_000 }),
        position({ positionId: "large", notionalUsd: 5_000_000, openedAtMs: NOW - 2 * 60_000 }),
      ],
      NOW,
    );

    expect(items.length).toBeGreaterThan(1);
    for (let i = 1; i < items.length; i += 1) {
      expect(items[i - 1]?.score).toBeGreaterThanOrEqual(items[i]?.score ?? 0);
    }
  });

  it("marks stale and unsupported positions as watch-only", () => {
    const items = buildPulseItems(
      [
        position({ positionId: "stale", stale: true, notionalUsd: 1_000_000 }),
        position({
          positionId: "unsupported",
          copyableOnPacifica: false,
          notionalUsd: 1_000_000,
        }),
      ],
      NOW,
    );

    expect(items.find((item) => item.position.positionId === "stale")?.canTail).toBe(false);
    expect(items.find((item) => item.position.positionId === "unsupported")?.canTail).toBe(false);
  });
});
