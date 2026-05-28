import { describe, expect, it } from "vitest";

import {
  buildPortfolioSummary,
  mergePortfolioSnapshotPayload,
  type PortfolioSnapshotPayload,
} from "./portfolio-snapshot";

describe("portfolio snapshot payload", () => {
  it("builds net worth from cached wallet, exchange equity, legacy positions, and pending funds", () => {
    const summary = buildPortfolioSummary({
      positions: [
        {
          id: "legacy-open",
          type: "perp",
          status: "confirmed",
          amountUsdc: 10,
          currentValueUsdc: 12,
          createdAt: "2026-05-28T12:00:00.000Z",
        },
        {
          id: "legacy-closed",
          type: "copy",
          status: "closed",
          amountUsdc: 10,
          proceedsUsdc: 14,
          createdAt: "2026-05-28T12:00:00.000Z",
          closedAt: "2026-05-28T12:05:00.000Z",
        },
      ],
      copyRows: [
        {
          betId: "tail-btc",
          venue: "pacifica",
          sourceKind: "tail",
          market: "BTC",
          side: "long",
          leverage: 25,
          stakeUsdc: 10,
          leaderAddress: null,
          leaderUsername: null,
          botId: null,
          botName: null,
          liveStatus: "open",
          entryPrice: 72_000,
          markPrice: 72_500,
          pricedAt: "2026-05-28T12:01:00.000Z",
          liquidationPrice: null,
          amountBase: 0.003,
          marginUsd: 10,
          marginMode: "cross",
          notionalUsd: 217.5,
          pnlUsd: 1.5,
          unrealizedPnlPct: 15,
          openedAt: "2026-05-28T12:00:00.000Z",
          positionUpdatedAt: "2026-05-28T12:01:00.000Z",
          leaderClosedAt: null,
        },
      ],
      pacificaAccount: {
        balanceUsd: 31,
        equityUsd: 42,
        availableToSpendUsd: 8,
        availableToWithdrawUsd: 8,
        totalMarginUsedUsd: 34,
        pendingDepositUsd: 3,
        pendingDeposits: [],
        updatedAt: "2026-05-28T12:01:00.000Z",
      },
      walletBalance: {
        stableUsd: 5,
        sol: 0.1,
        updatedAt: "2026-05-28T12:01:00.000Z",
      },
    });

    expect(summary).toMatchObject({
      walletStableUsd: 5,
      pacificaEquityUsd: 42,
      availableCashUsd: 13,
      positionsValueUsd: 23.5,
      openCount: 2,
      closedCount: 1,
      netWorthUsd: 62,
      processingFundsUsd: 3,
    });
    expect(summary.positionsPnlUsd).toBeCloseTo(3.5);
    expect(summary.positionsPnlPct).toBeCloseTo(17.5);
  });

  it("keeps last live rows when a delayed refresh returns blank syncing rows", () => {
    const previous: PortfolioSnapshotPayload = {
      positions: [],
      copyRows: [
        {
          betId: "tail-btc",
          venue: "pacifica",
          sourceKind: "tail",
          market: "BTC",
          side: "long",
          leverage: 25,
          stakeUsdc: 10,
          leaderAddress: null,
          leaderUsername: null,
          botId: null,
          botName: null,
          liveStatus: "open",
          entryPrice: 72_000,
          markPrice: 72_500,
          pricedAt: "2026-05-28T12:01:00.000Z",
          liquidationPrice: null,
          amountBase: 0.003,
          marginUsd: 10,
          marginMode: "cross",
          notionalUsd: 217.5,
          pnlUsd: 1.5,
          unrealizedPnlPct: 15,
          openedAt: "2026-05-28T12:00:00.000Z",
          positionUpdatedAt: "2026-05-28T12:01:00.000Z",
          leaderClosedAt: null,
        },
      ],
      pacificaAccount: {
        balanceUsd: 31,
        equityUsd: 42,
        availableToSpendUsd: 8,
        availableToWithdrawUsd: 8,
        totalMarginUsedUsd: 34,
        pendingDepositUsd: 0,
        pendingDeposits: [],
        updatedAt: "2026-05-28T12:01:00.000Z",
      },
      walletBalance: {
        stableUsd: 5,
        sol: 0.1,
        updatedAt: "2026-05-28T12:01:00.000Z",
      },
    };
    const next: PortfolioSnapshotPayload = {
      positions: [],
      copyRows: [
        {
          ...previous.copyRows[0],
          liveStatus: "unknown",
          entryPrice: null,
          markPrice: null,
          pricedAt: null,
          notionalUsd: null,
          pnlUsd: null,
          unrealizedPnlPct: null,
        },
      ],
      pacificaAccount: null,
      walletBalance: null,
    };

    expect(mergePortfolioSnapshotPayload(previous, next)).toMatchObject({
      copyRows: [
        {
          liveStatus: "open",
          markPrice: 72_500,
          notionalUsd: 217.5,
          pnlUsd: 1.5,
          unrealizedPnlPct: 15,
        },
      ],
      pacificaAccount: previous.pacificaAccount,
      walletBalance: previous.walletBalance,
    });
  });
});
