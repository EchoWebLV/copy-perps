import { describe, expect, it } from "vitest";
import { closedFlashTailCopyRows } from "./flash-tail-closed";

function flashTailMeta(overrides: Record<string, unknown> = {}) {
  return {
    sourceType: "flash-tail",
    venue: "flash",
    sourceKind: "whale",
    whaleId: "whale-1",
    botId: null,
    sourceName: "Big Whale",
    sourcePositionId: "pos-1",
    market: "SOL",
    side: "long",
    leverage: 20,
    mode: "standard",
    walletAddress: "wallet-1",
    entryPriceUsd: 160,
    notionalUsd: 20,
    openFeeUsd: 0.01,
    openSignature: "sig-open",
    closeSignature: "sig-close",
    closeReason: "manual",
    proceedsSource: "quote-estimate",
    reconciledAt: null,
    ...overrides,
  };
}

function betRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bet-1",
    type: "flash-tail",
    status: "closed",
    amountUsdc: 1,
    proceedsUsdc: 1.24,
    meta: flashTailMeta(),
    createdAt: new Date("2026-06-11T10:00:00.000Z"),
    closedAt: new Date("2026-06-11T11:00:00.000Z"),
    ...overrides,
  };
}

describe("closedFlashTailCopyRows", () => {
  it("emits a closed copy row with realized pnl and whale attribution", () => {
    const rows = closedFlashTailCopyRows([betRow()]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      betId: "bet-1",
      venue: "flash",
      sourceKind: "tail",
      market: "SOL",
      side: "long",
      leverage: 20,
      stakeUsdc: 1,
      openFeeUsd: 0.01,
      whaleId: "whale-1",
      whaleName: "Big Whale",
      botId: null,
      botName: null,
      closeReason: "manual",
      liveStatus: "closed",
      entryPrice: 160,
      markPrice: null,
      pricedAt: null,
      notionalUsd: 20,
      openedAt: "2026-06-11T10:00:00.000Z",
      closedAt: "2026-06-11T11:00:00.000Z",
      positionUpdatedAt: "2026-06-11T11:00:00.000Z",
    });
    expect(rows[0].pnlUsd).toBeCloseTo(0.24);
    expect(rows[0].unrealizedPnlPct).toBeCloseTo(24);
  });

  it("attributes bot-sourced tails to the bot, not the whale", () => {
    const rows = closedFlashTailCopyRows([
      betRow({
        meta: flashTailMeta({
          sourceKind: "bot",
          whaleId: null,
          botId: "pulse",
          sourceName: "Pulse",
        }),
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      whaleId: null,
      whaleName: null,
      botId: "pulse",
      botName: "Pulse",
    });
  });

  it("leaves pnl null when proceeds were never recorded", () => {
    const rows = closedFlashTailCopyRows([betRow({ proceedsUsdc: null })]);

    expect(rows).toHaveLength(1);
    expect(rows[0].pnlUsd).toBeNull();
    expect(rows[0].unrealizedPnlPct).toBeNull();
  });

  it("includes externally-closed tails with unknown pnl", () => {
    const rows = closedFlashTailCopyRows([
      betRow({
        status: "closed-external",
        proceedsUsdc: null,
        meta: flashTailMeta({
          closeSignature: null,
          closeReason: "external",
          proceedsSource: null,
        }),
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      betId: "bet-1",
      closeReason: "external",
      liveStatus: "closed",
    });
    expect(rows[0].pnlUsd).toBeNull();
    expect(rows[0].unrealizedPnlPct).toBeNull();
  });

  it("labels closed autopilot rows via botName", () => {
    const rows = closedFlashTailCopyRows([
      betRow({
        id: "bet-ap",
        amountUsdc: 5,
        proceedsUsdc: 7.5,
        meta: flashTailMeta({
          sourceKind: "autopilot",
          whaleId: null,
          botId: null,
          sourceName: "Autopilot",
          sourcePositionId: null,
          autopilotSessionId: "sess-1",
        }),
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].botName).toBe("Autopilot");
    expect(rows[0].whaleName).toBeNull();
    expect(rows[0].pnlUsd).toBe(2.5);
  });

  it("skips other bet types, non-closed statuses, and junk meta", () => {
    const rows = closedFlashTailCopyRows([
      betRow({ type: "copy" }),
      betRow({ status: "confirmed" }),
      betRow({ status: "abandoned" }),
      betRow({ meta: null }),
      betRow({ meta: { sourceType: "whale" } }),
    ]);

    expect(rows).toEqual([]);
  });
});
