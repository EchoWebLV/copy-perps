import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const limit = vi.fn();
  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    limit,
  };

  return {
    dbSelect: vi.fn(() => selectChain),
    limit,
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    select: mocks.dbSelect,
  },
}));

import { loadPortfolioSnapshotForUser } from "./portfolio-snapshot-store";

describe("portfolio snapshot store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rebuilds cached summary from the payload using the current formula", async () => {
    mocks.limit.mockResolvedValue([
      {
        userId: "user-1",
        payload: {
          positions: [
            {
              id: "copy-open",
              type: "copy",
              status: "confirmed",
              amountUsdc: 10,
              createdAt: "2026-05-28T12:00:00.000Z",
            },
          ],
          copyRows: [
            {
              betId: "copy-open",
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
              markPrice: 72_360,
              pricedAt: "2026-05-28T12:01:00.000Z",
              liquidationPrice: null,
              amountBase: 0.003,
              marginUsd: 10,
              marginMode: "cross",
              notionalUsd: 217.08,
              pnlUsd: 1,
              unrealizedPnlPct: 10,
              openedAt: "2026-05-28T12:00:00.000Z",
              positionUpdatedAt: "2026-05-28T12:01:00.000Z",
              leaderClosedAt: null,
            },
          ],
          pacificaAccount: {
            balanceUsd: 49,
            equityUsd: 48,
            availableToSpendUsd: 33,
            availableToWithdrawUsd: 13,
            totalMarginUsedUsd: 15,
            pendingDepositUsd: 0,
            pendingDeposits: [],
            updatedAt: "2026-05-28T12:01:00.000Z",
          },
          walletBalance: {
            stableUsd: 3.5,
            sol: 0.1,
            updatedAt: "2026-05-28T12:01:00.000Z",
          },
        },
        summary: {
          netWorthUsd: 999,
          legacyPositionsValueUsd: 10,
        },
        status: "live",
        staleReason: null,
        refreshedAt: new Date("2026-05-28T12:02:00.000Z"),
      },
    ]);

    const snapshot = await loadPortfolioSnapshotForUser("user-1");

    expect(snapshot?.summary).toMatchObject({
      netWorthUsd: 51.5,
      legacyPositionsValueUsd: 0,
      copyRowsValueUsd: 11,
    });
  });
});
