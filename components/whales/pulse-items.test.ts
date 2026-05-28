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
  it("creates one best social tape item from each live whale position", () => {
    const items = buildPulseItems(
      [
        position({ positionId: "fresh", openedAtMs: NOW - 2 * 60_000 }),
        position({
          positionId: "big",
          openedAtMs: NOW - 2 * 60 * 60_000,
          notionalUsd: 1_200_000,
          unrealizedPnlPct: 10,
        }),
        position({
          positionId: "profit",
          openedAtMs: NOW - 2 * 60 * 60_000,
          unrealizedPnlPct: 58,
        }),
        position({
          positionId: "pain",
          openedAtMs: NOW - 2 * 60 * 60_000,
          unrealizedPnlPct: -18,
        }),
        position({
          positionId: "gap",
          openedAtMs: NOW - 2 * 60 * 60_000,
          unrealizedPnlPct: 10,
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

    expect(items).toHaveLength(5);
    expect(new Set(items.map((item) => item.position.positionId)).size).toBe(5);
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

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("deep_profit");
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
          openedAtMs: NOW - 2 * 60 * 60_000,
          unrealizedPnlPct: -18,
        }),
      ],
      NOW,
    );

    expect(items.find((item) => item.kind === "pain_trade")?.headline).toBe(
      "SOL long is already down 18.0%",
    );
  });

  it("sorts items by newest opened position before pulse score", () => {
    const items = buildPulseItems(
      [
        position({
          positionId: "older-hot",
          leverage: 40,
          notionalUsd: 5_000_000,
          openedAtMs: NOW - 4 * 60 * 60_000,
          unrealizedPnlPct: 300,
        }),
        position({
          positionId: "newer-cool",
          notionalUsd: 80_000,
          openedAtMs: NOW - 5 * 60_000,
          unrealizedPnlPct: 26,
        }),
      ],
      NOW,
    );

    expect(items.length).toBeGreaterThan(1);
    expect(items[0]?.position.positionId).toBe("newer-cool");
    for (let i = 1; i < items.length; i += 1) {
      const previous = items[i - 1]?.position.openedAtMs ?? 0;
      const current = items[i]?.position.openedAtMs ?? 0;
      expect(previous).toBeGreaterThanOrEqual(current);
    }
  });

  it("keeps stale supported positions tail-ready and hides unsupported markets", () => {
    const items = buildPulseItems(
      [
        position({ positionId: "stale", stale: true, notionalUsd: 1_000_000 }),
        position({
          positionId: "aged-out",
          stale: false,
          lastSeenAtMs: NOW - 4 * 60_000,
          notionalUsd: 1_000_000,
        }),
        position({
          positionId: "unsupported",
          market: "HYPE",
          copyableOnPacifica: false,
          notionalUsd: 1_000_000,
        }),
      ],
      NOW,
    );

    expect(items.find((item) => item.position.positionId === "stale")?.canTail).toBe(true);
    expect(items.find((item) => item.position.positionId === "aged-out")?.canTail).toBe(true);
    expect(items.find((item) => item.position.positionId === "unsupported")).toBeUndefined();
  });
});
