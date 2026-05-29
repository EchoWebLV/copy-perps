import { describe, expect, it } from "vitest";
import type { WhalePositionSignal } from "@/lib/types";
import { mergePulsePositionSignals } from "./pulse-position-retention";

const NOW = 1_780_044_900_000;

function signal(
  overrides: Partial<WhalePositionSignal["payload"]> = {},
): WhalePositionSignal {
  const payload: WhalePositionSignal["payload"] = {
    positionId: overrides.positionId ?? "pos-1",
    whaleId: overrides.whaleId ?? "whale-1",
    source: overrides.source ?? "hyperliquid",
    sourceAccount: overrides.sourceAccount ?? "0xabc",
    displayName: overrides.displayName ?? "HL Alpha",
    avatarUrl: overrides.avatarUrl ?? null,
    market: overrides.market ?? "BTC",
    side: overrides.side ?? "long",
    leverage: overrides.leverage ?? 10,
    maxLeverage: overrides.maxLeverage ?? 40,
    amountBase: overrides.amountBase ?? 1,
    notionalUsd: overrides.notionalUsd ?? 1_000_000,
    entryPrice: overrides.entryPrice ?? 70_000,
    currentMark: overrides.currentMark ?? 70_500,
    unrealizedPnlPct: overrides.unrealizedPnlPct ?? 5,
    openedAtMs: overrides.openedAtMs ?? NOW - 20 * 60_000,
    lastSeenAtMs: overrides.lastSeenAtMs ?? NOW - 8 * 60_000,
    stale: overrides.stale ?? true,
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

describe("mergePulsePositionSignals", () => {
  it("keeps recent current positions when an incoming poll is partial", () => {
    const current = [
      signal({ positionId: "recent-hl", openedAtMs: NOW - 25 * 60_000 }),
    ];
    const incoming = [signal({ positionId: "new-pacifica", source: "pacifica" })];

    expect(
      mergePulsePositionSignals(current, incoming, NOW).map(
        (item) => item.payload.positionId,
      ),
    ).toEqual(["new-pacifica", "recent-hl"]);
  });

  it("uses incoming data for matching positions", () => {
    const current = [signal({ positionId: "same", currentMark: 70_000 })];
    const incoming = [signal({ positionId: "same", currentMark: 71_000 })];

    expect(mergePulsePositionSignals(current, incoming, NOW)).toEqual(incoming);
  });

  it("drops old missing positions after the retention window", () => {
    const current = [
      signal({
        positionId: "old-stale",
        openedAtMs: NOW - 2 * 60 * 60_000,
        lastSeenAtMs: NOW - 20 * 60_000,
      }),
    ];
    const incoming = [signal({ positionId: "fresh" })];

    expect(
      mergePulsePositionSignals(current, incoming, NOW).map(
        (item) => item.payload.positionId,
      ),
    ).toEqual(["fresh"]);
  });
});
