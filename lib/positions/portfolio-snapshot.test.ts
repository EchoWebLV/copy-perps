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
      pacificaAccount: null,
      walletBalance: null,
    });
  });

  it("does not carry stale exchange equity into a refreshed delayed snapshot", () => {
    const previous: PortfolioSnapshotPayload = {
      positions: [],
      copyRows: [],
      pacificaAccount: {
        balanceUsd: 69,
        equityUsd: 68.87,
        availableToSpendUsd: 33.66,
        availableToWithdrawUsd: 13.5,
        totalMarginUsedUsd: 15.22,
        pendingDepositUsd: 0,
        pendingDeposits: [],
        updatedAt: "2026-05-28T18:50:00.000Z",
      },
      walletBalance: {
        stableUsd: 3.52,
        sol: 0.1547,
        updatedAt: "2026-05-28T18:50:00.000Z",
      },
    };
    const next: PortfolioSnapshotPayload = {
      positions: [],
      copyRows: [],
      pacificaAccount: null,
      walletBalance: {
        stableUsd: 3.52,
        sol: 0.1547,
        updatedAt: "2026-05-28T19:10:00.000Z",
      },
    };

    const merged = mergePortfolioSnapshotPayload(previous, next, {
      preserveMissingOpenRows: true,
    });
    const summary = buildPortfolioSummary(merged);

    expect(merged.pacificaAccount).toBeNull();
    expect(summary.pacificaEquityUsd).toBeNull();
    expect(summary.netWorthUsd).toBeCloseTo(3.52);
    expect(summary.netWorthUsd).not.toBeCloseTo(72.39);
  });
});
