import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectUserLimit = vi.fn();
  const selectBetsOrderBy = vi.fn();
  const selectUserChain = {
    from: vi.fn(() => selectUserChain),
    where: vi.fn(() => selectUserChain),
    limit: selectUserLimit,
  };
  const selectBetsChain = {
    from: vi.fn(() => selectBetsChain),
    where: vi.fn(() => selectBetsChain),
    orderBy: selectBetsOrderBy,
  };
  const updateWhere = vi.fn();
  const updateSet = vi.fn(() => ({
    where: updateWhere,
  }));

  return {
    verifyPrivyRequest: vi.fn(),
    selectUserLimit,
    selectBetsOrderBy,
    selectUserChain,
    selectBetsChain,
    updateSet,
    updateWhere,
    dbSelect: vi.fn(),
    enrichBet: vi.fn(),
    getPositions: vi.fn(),
    getAccountInfo: vi.fn(),
    findUncreditedPacificaDeposits: vi.fn(),
    getMarksSnapshot: vi.fn(),
    getMark: vi.fn(),
    getBot: vi.fn(),
    getFlashPerpsService: vi.fn(),
    flashPositionsOf: vi.fn(),
    savePortfolioSnapshotForUser: vi.fn(),
    getUsdcBalance: vi.fn(),
    getJupUsdBalance: vi.fn(),
    getSolBalance: vi.fn(),
  };
});

vi.mock("@/lib/privy/server", () => ({
  verifyPrivyRequest: mocks.verifyPrivyRequest,
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: mocks.dbSelect,
    update: () => ({
      set: mocks.updateSet,
    }),
  },
}));
vi.mock("@/lib/positions/enrich", () => ({
  enrichBet: mocks.enrichBet,
}));
vi.mock("@/lib/pacifica/client", () => ({
  getPositions: mocks.getPositions,
  getAccountInfo: mocks.getAccountInfo,
}));
vi.mock("@/lib/pacifica/deposit-reconcile", () => ({
  findUncreditedPacificaDeposits: mocks.findUncreditedPacificaDeposits,
}));
vi.mock("@/lib/data/marks", () => ({
  getMarksSnapshot: mocks.getMarksSnapshot,
  getMark: mocks.getMark,
}));
vi.mock("@/lib/bots", () => ({
  getBot: mocks.getBot,
}));
vi.mock("@/lib/flash/perps", () => ({
  getFlashPerpsService: mocks.getFlashPerpsService,
}));
vi.mock("@/lib/positions/portfolio-snapshot-store", () => ({
  savePortfolioSnapshotForUser: mocks.savePortfolioSnapshotForUser,
}));
vi.mock("@/lib/solana/balance", () => ({
  getUsdcBalance: mocks.getUsdcBalance,
  getJupUsdBalance: mocks.getJupUsdBalance,
  getSolBalance: mocks.getSolBalance,
}));

import { GET } from "../../app/api/portfolio/route";

describe("GET /api/portfolio", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyPrivyRequest.mockResolvedValue({ userId: "privy-user" });
    mocks.dbSelect
      .mockReturnValueOnce(mocks.selectUserChain)
      .mockReturnValueOnce(mocks.selectBetsChain);
    mocks.selectUserLimit.mockResolvedValue([
      {
        id: "user-1",
        privyId: "privy-user",
        solanaPubkey: null,
      },
    ]);
    mocks.updateWhere.mockResolvedValue(undefined);
    mocks.enrichBet.mockImplementation(async (bet) => ({ id: bet.id }));
    mocks.getPositions.mockResolvedValue([]);
    mocks.getAccountInfo.mockResolvedValue({
      balance: "0",
      account_equity: "0",
      available_to_spend: "0",
      available_to_withdraw: "0",
      total_margin_used: "0",
      updated_at: 0,
    });
    mocks.findUncreditedPacificaDeposits.mockResolvedValue({
      totalUsdc: 0,
      deposits: [],
    });
    mocks.getMarksSnapshot.mockResolvedValue(new Map());
    mocks.getMark.mockResolvedValue(null);
    mocks.getBot.mockReturnValue(null);
    mocks.getFlashPerpsService.mockReturnValue({
      positionsOf: mocks.flashPositionsOf,
    });
    mocks.flashPositionsOf.mockResolvedValue([]);
    mocks.getUsdcBalance.mockResolvedValue(0);
    mocks.getJupUsdBalance.mockResolvedValue(0);
    mocks.getSolBalance.mockResolvedValue(0);
    mocks.savePortfolioSnapshotForUser.mockImplementation(
      async ({ payload, status, staleReason }) => ({
        payload,
        summary: null,
        snapshot: {
          source: "live",
          status,
          updatedAt: "2026-05-25T17:40:00.000Z",
          staleReason,
        },
      }),
    );
  });

  it("skips malformed confirmed copy metadata without emitting invalid copy rows", async () => {
    mocks.selectBetsOrderBy.mockResolvedValue([
      {
        id: "copy-null",
        userId: "user-1",
        type: "copy",
        amountUsdc: 10,
        status: "confirmed",
        meta: null,
        createdAt: new Date("2026-05-23T12:00:00.000Z"),
      },
      {
        id: "copy-string",
        userId: "user-1",
        type: "copy",
        amountUsdc: 10,
        status: "confirmed",
        meta: "bad-meta",
        createdAt: new Date("2026-05-23T12:00:00.000Z"),
      },
      {
        id: "copy-missing-side",
        userId: "user-1",
        type: "copy",
        amountUsdc: 10,
        status: "confirmed",
        meta: {
          leaderMarket: "ETH",
          leverage: 5,
        },
        createdAt: new Date("2026-05-23T12:00:00.000Z"),
      },
    ]);

    const response = await GET(new Request("http://local.test/api/portfolio"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      copyRows: [],
    });
  });

  it("emits whale copy rows with live wallet position details when the fill price was not returned", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T17:40:00.000Z"));
    mocks.selectUserLimit.mockResolvedValueOnce([
      {
        id: "user-1",
        privyId: "privy-user",
        solanaPubkey: "wallet-1",
      },
    ]);
    mocks.getPositions.mockResolvedValue([
      {
        symbol: "MON",
        side: "ask",
        amount: "563",
        entry_price: "0.02653",
        margin: "0",
        funding: "0",
        isolated: false,
        liquidation_price: "0.037955",
        created_at: 1779730644087,
        updated_at: 1779730644087,
      },
    ]);
    mocks.getMark.mockResolvedValue(0.0267);
    mocks.selectBetsOrderBy.mockResolvedValue([
      {
        id: "copy-live",
        userId: "user-1",
        type: "copy",
        amountUsdc: 5,
        status: "confirmed",
        meta: {
          sourceType: "whale",
          whaleId: "hyperliquid:0xf28e",
          source: "hyperliquid",
          sourceAccount: "0xf28e1b06e00e8774c612e31ab3ac35d5a720085f",
          sourcePositionId: "hyperliquid:0xf28e:MON:short:30593",
          leaderMarket: "MON",
          leaderSide: "short",
          leverage: 3,
          autoCloseOnSourceClose: true,
          userEntryPrice: null,
          sourceEntryPriceAtCopy: 0.030593,
          pacificaOrderId: 8894267526,
          closeReason: null,
        },
        createdAt: new Date("2026-05-25T17:37:23.573Z"),
      },
    ]);

    const response = await GET(new Request("http://local.test/api/portfolio"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.copyRows).toHaveLength(1);
    expect(body.copyRows[0]).toMatchObject({
      betId: "copy-live",
      sourceKind: "tail",
      market: "MON",
      side: "short",
      leverage: 3,
      stakeUsdc: 5,
      leaderAddress: "0xf28e1b06e00e8774c612e31ab3ac35d5a720085f",
      whaleId: "hyperliquid:0xf28e",
      autoCloseOnSourceClose: true,
      botId: null,
      botName: null,
      liveStatus: "open",
      entryPrice: 0.02653,
      markPrice: 0.0267,
      pricedAt: "2026-05-25T17:40:00.000Z",
      liquidationPrice: 0.037955,
      amountBase: 563,
      marginUsd: null,
      marginMode: "cross",
      openedAt: "2026-05-25T17:37:24.087Z",
      positionUpdatedAt: "2026-05-25T17:37:24.087Z",
    });
    expect(body.copyRows[0].notionalUsd).toBeCloseTo(15.0321);
    expect(body.copyRows[0].pnlUsd).toBeCloseTo(-0.09571);
    expect(body.copyRows[0].unrealizedPnlPct).toBeCloseTo(-1.9142);
    expect(mocks.getMarksSnapshot).toHaveBeenCalledWith({ maxAgeMs: 3000 });
  });

  it("emits unmatched live Pacifica wallet positions even without a copy bet", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T17:40:00.000Z"));
    mocks.selectUserLimit.mockResolvedValueOnce([
      {
        id: "user-1",
        privyId: "privy-user",
        solanaPubkey: "wallet-1",
      },
    ]);
    mocks.selectBetsOrderBy.mockResolvedValue([]);
    mocks.getPositions.mockResolvedValue([
      {
        symbol: "BTC",
        side: "bid",
        amount: "0.001",
        entry_price: "100000",
        margin: "0",
        funding: "0",
        isolated: false,
        liquidation_price: "80000",
        created_at: 1779730000000,
        updated_at: 1779730500000,
      },
    ]);
    mocks.getMarksSnapshot.mockResolvedValue(new Map([["BTC", 101000]]));

    const response = await GET(new Request("http://local.test/api/portfolio"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.copyRows).toHaveLength(1);
    expect(body.copyRows[0]).toMatchObject({
      betId: null,
      sourceKind: "wallet",
      market: "BTC",
      side: "long",
      stakeUsdc: null,
      leaderAddress: null,
      autoCloseOnSourceClose: false,
      liveStatus: "open",
      entryPrice: 100000,
      markPrice: 101000,
      pricedAt: "2026-05-25T17:40:00.000Z",
      liquidationPrice: 80000,
      amountBase: 0.001,
      marginUsd: null,
      marginMode: "cross",
      notionalUsd: 101,
      pnlUsd: 1,
      unrealizedPnlPct: null,
      openedAt: "2026-05-25T17:26:40.000Z",
      positionUpdatedAt: "2026-05-25T17:35:00.000Z",
    });
  });

  it("emits live Flash wallet positions into the same open portfolio rows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T14:15:00.000Z"));
    mocks.selectUserLimit.mockResolvedValueOnce([
      {
        id: "user-1",
        privyId: "privy-user",
        solanaPubkey: "wallet-1",
      },
    ]);
    mocks.selectBetsOrderBy.mockResolvedValue([]);
    mocks.getPositions.mockResolvedValue([]);
    mocks.flashPositionsOf.mockResolvedValue([
      {
        symbol: "SOL",
        side: "short",
        positionPubkey: "flash-sol-short",
        marketAccount: "flash-market",
        entryPriceUsd: 160,
        markPriceUsd: 158,
        sizeUsd: 1000,
        collateralUsd: 9.5,
        leverage: 100,
        liquidationPriceUsd: 161.6,
        pnlUsd: 1.25,
        receiveUsd: 10.75,
        isProfitable: true,
        openTime: 1779977400000,
      },
    ]);

    const response = await GET(new Request("http://local.test/api/portfolio"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(mocks.flashPositionsOf).toHaveBeenCalledWith("wallet-1");
    expect(body.copyRows).toHaveLength(1);
    expect(body.copyRows[0]).toMatchObject({
      betId: null,
      venue: "flash",
      sourceKind: "wallet",
      market: "SOL",
      side: "short",
      leverage: 100,
      stakeUsdc: 10,
      liveStatus: "open",
      entryPrice: 160,
      markPrice: 158,
      pricedAt: "2026-05-28T14:15:00.000Z",
      liquidationPrice: 161.6,
      marginUsd: 9.5,
      marginMode: "isolated",
      notionalUsd: 1000,
      pnlUsd: 1.25,
      unrealizedPnlPct: 12.5,
      openedAt: "2026-05-28T14:10:00.000Z",
      positionUpdatedAt: "2026-05-28T14:15:00.000Z",
    });
  });

  it("returns flat Pacifica account cash after positions are closed", async () => {
    mocks.selectUserLimit.mockResolvedValueOnce([
      {
        id: "user-1",
        privyId: "privy-user",
        solanaPubkey: "wallet-1",
      },
    ]);
    mocks.selectBetsOrderBy.mockResolvedValue([]);
    mocks.getPositions.mockResolvedValue([]);
    mocks.getAccountInfo.mockResolvedValue({
      balance: "9.954257",
      account_equity: "9.954257",
      available_to_spend: "9.954257",
      available_to_withdraw: "9.954257",
      total_margin_used: "0",
      updated_at: 1779731922548,
    });

    const response = await GET(new Request("http://local.test/api/portfolio"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      copyRows: [],
      pacificaAccount: {
        balanceUsd: 9.954257,
        equityUsd: 9.954257,
        availableToSpendUsd: 9.954257,
        availableToWithdrawUsd: 9.954257,
        totalMarginUsedUsd: 0,
        updatedAt: "2026-05-25T17:58:42.548Z",
      },
    });
  });

  it("includes uncredited Pacifica deposits as pending portfolio funds", async () => {
    mocks.selectUserLimit.mockResolvedValueOnce([
      {
        id: "user-1",
        privyId: "privy-user",
        solanaPubkey: "wallet-1",
      },
    ]);
    mocks.selectBetsOrderBy.mockResolvedValue([]);
    mocks.getPositions.mockResolvedValue([]);
    mocks.getAccountInfo.mockResolvedValue({
      balance: "9.780636",
      account_equity: "9.697111",
      available_to_spend: "4.705972",
      available_to_withdraw: "-0.285167",
      total_margin_used: "4.991139",
      updated_at: 1779794748480,
    });
    mocks.findUncreditedPacificaDeposits.mockResolvedValue({
      totalUsdc: 4.306925,
      deposits: [
        {
          amountUsdc: 4.306925,
          signature: "pending-sig",
          createdAt: "2026-05-26T11:12:39.000Z",
        },
      ],
    });

    const response = await GET(new Request("http://local.test/api/portfolio"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      pacificaAccount: {
        equityUsd: 9.697111,
        pendingDepositUsd: 4.306925,
        pendingDeposits: [
          {
            amountUsdc: 4.306925,
            signature: "pending-sig",
            createdAt: "2026-05-26T11:12:39.000Z",
          },
        ],
      },
    });
  });
});
