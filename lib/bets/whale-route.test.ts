import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectLimit = vi.fn();
  const selectChain = {
    from: vi.fn(() => selectChain),
    innerJoin: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    limit: selectLimit,
  };
  const insertValues = vi.fn();
  const insertReturning = vi.fn();
  const updateSet = vi.fn();
  const updateWhere = vi.fn();
  const updateReturning = vi.fn();

  return {
    PacificaDepositPendingError: class PacificaDepositPendingError extends Error {
      constructor(public recentDepositUsdc: number) {
        super(`pending ${recentDepositUsdc}`);
        this.name = "PacificaDepositPendingError";
      }
    },
    PacificaDepositSettlingError: class PacificaDepositSettlingError extends Error {
      retryAfterMs = 2000;

      constructor(public recentDepositUsdc: number) {
        super(`settling ${recentDepositUsdc}`);
        this.name = "PacificaDepositSettlingError";
      }
    },
    whaleSocialEnabled: vi.fn(),
    verifyPrivyRequest: vi.fn(),
    ensureUser: vi.fn(),
    getAgentWallet: vi.fn(),
    getMark: vi.fn(),
    clampLeverageForNotional: vi.fn(),
    getMarketBySymbol: vi.fn(),
    openCopyOrder: vi.fn(),
    closeCopyOrder: vi.fn(),
    planOnboarding: vi.fn(),
    planPacificaDepositTopUp: vi.fn(),
    hasOpenTailOnMarket: vi.fn(),
    getWhaleLivePositionById: vi.fn(),
    reserveTailOnMarket: vi.fn(),
    blockTailReservation: vi.fn(),
    releaseTailReservation: vi.fn(),
    selectChain,
    selectLimit,
    insertValues,
    insertReturning,
    updateSet,
    updateWhere,
    updateReturning,
  };
});

vi.mock("@/lib/features", () => ({
  whaleSocialEnabled: mocks.whaleSocialEnabled,
}));
vi.mock("@/lib/privy/server", () => ({
  verifyPrivyRequest: mocks.verifyPrivyRequest,
}));
vi.mock("@/lib/users/ensure", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/wallets/agent", () => ({
  getAgentWallet: mocks.getAgentWallet,
}));
vi.mock("@/lib/data/marks", () => ({
  getMark: mocks.getMark,
}));
vi.mock("@/lib/pacifica/markets", () => ({
  clampLeverageForNotional: mocks.clampLeverageForNotional,
  getMarketBySymbol: mocks.getMarketBySymbol,
}));
vi.mock("@/lib/pacifica/orders", () => ({
  openCopyOrder: mocks.openCopyOrder,
  closeCopyOrder: mocks.closeCopyOrder,
}));
vi.mock("@/lib/bets/onboard", () => ({
  planOnboarding: mocks.planOnboarding,
}));
vi.mock("@/lib/bets/funding", () => ({
  PacificaDepositPendingError: mocks.PacificaDepositPendingError,
  PacificaDepositSettlingError: mocks.PacificaDepositSettlingError,
  planPacificaDepositTopUp: mocks.planPacificaDepositTopUp,
}));
vi.mock("@/lib/bets/copy-guard", () => ({
  hasOpenTailOnMarket: mocks.hasOpenTailOnMarket,
}));
vi.mock("@/lib/whales/live-cache", () => ({
  getWhaleLivePositionById: mocks.getWhaleLivePositionById,
}));
vi.mock("@/lib/bets/tail-reservation", () => ({
  reserveTailOnMarket: mocks.reserveTailOnMarket,
  blockTailReservation: mocks.blockTailReservation,
  releaseTailReservation: mocks.releaseTailReservation,
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => mocks.selectChain,
    insert: () => ({
      values: mocks.insertValues,
    }),
    update: () => ({
      set: mocks.updateSet,
    }),
  },
}));

import { POST } from "../../app/api/bet/whale/route";

function whaleRequest(body: unknown) {
  return new Request("http://local.test/api/bet/whale", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer token",
    },
    body: JSON.stringify(body),
  });
}

function openPacificaSource(overrides?: {
  source?: string;
  status?: string;
  whaleStatus?: string;
  currentMark?: number | null;
  lastSeenAt?: Date;
}) {
  const source = overrides?.source ?? "pacifica";
  return {
    position: {
      id: "source-pos-1",
      whaleId: `${source}:abc`,
      source,
      sourceAccount: "abc",
      market: "ETH",
      side: "long",
      leverage: 7,
      entryPrice: 2000,
      currentMark: overrides?.currentMark ?? null,
      status: overrides?.status ?? "open",
      lastSeenAt: overrides?.lastSeenAt ?? new Date("2026-05-23T12:00:00.000Z"),
    },
    whale: {
      id: `${source}:abc`,
      source,
      sourceAccount: "abc",
      displayName: "Whale ABC",
      status: overrides?.whaleStatus ?? "active",
    },
  };
}

describe("POST /api/bet/whale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T12:00:30.000Z"));
    mocks.whaleSocialEnabled.mockReturnValue(true);
    mocks.verifyPrivyRequest.mockResolvedValue({ userId: "privy-user" });
    mocks.ensureUser.mockResolvedValue({
      id: "user-1",
      solanaPubkey: "wallet-1",
    });
    mocks.getAgentWallet.mockResolvedValue({
      mainPubkey: "wallet-1",
      agentPubkey: "agent-1",
      agentSecretKey: new Uint8Array(32),
    });
    mocks.getWhaleLivePositionById.mockResolvedValue(openPacificaSource());
    mocks.hasOpenTailOnMarket.mockResolvedValue(false);
    mocks.getMark.mockResolvedValue(2000);
    mocks.clampLeverageForNotional.mockResolvedValue(5);
    mocks.getMarketBySymbol.mockResolvedValue({
      symbol: "ETH",
      lot_size: "0.001",
    });
    mocks.planPacificaDepositTopUp.mockResolvedValue(null);
    mocks.reserveTailOnMarket.mockResolvedValue(true);
    mocks.blockTailReservation.mockResolvedValue(undefined);
    mocks.releaseTailReservation.mockResolvedValue(undefined);
    mocks.openCopyOrder.mockResolvedValue({
      order_id: "order-1",
      avg_fill_price: "2010.50",
      filled_amount: "0.025",
      side: "bid",
    });
    mocks.closeCopyOrder.mockResolvedValue({
      order_id: "close-order-1",
      avg_fill_price: "2009.50",
      filled_amount: "0.025",
      side: "ask",
    });
    mocks.insertValues.mockReturnValue({
      returning: mocks.insertReturning,
    });
    mocks.insertReturning.mockResolvedValue([{ id: "bet-1" }]);
    mocks.updateSet.mockReturnValue({
      where: mocks.updateWhere,
    });
    mocks.updateWhere.mockReturnValue({
      returning: mocks.updateReturning,
    });
    mocks.updateReturning.mockResolvedValue([{ id: "bet-1" }]);
  });

  it("returns 404 before auth when whale social is disabled", async () => {
    mocks.whaleSocialEnabled.mockReturnValue(false);

    const response = await POST(
      whaleRequest({
        positionId: "source-pos-1",
        stakeUsdc: 10,
        walletAddress: "wallet-1",
        autoCloseOnSourceClose: true,
      }),
    );

    expect(response.status).toBe(404);
    expect(mocks.verifyPrivyRequest).not.toHaveBeenCalled();
    expect(mocks.openCopyOrder).not.toHaveBeenCalled();
  });

  it("opens a Pacifica whale copy and stores whale metadata", async () => {
    const response = await POST(
      whaleRequest({
        positionId: "source-pos-1",
        stakeUsdc: 10,
        walletAddress: "wallet-1",
        autoCloseOnSourceClose: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.hasOpenTailOnMarket).toHaveBeenCalledWith("user-1", "ETH");
    expect(mocks.clampLeverageForNotional).toHaveBeenCalledWith("ETH", 70);
    expect(mocks.openCopyOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "ETH",
        side: "long",
        amountBase: "0.025",
      }),
    );
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        type: "copy",
        amountUsdc: 10,
        status: "pending",
        meta: expect.objectContaining({
          sourceType: "whale",
          whaleId: "pacifica:abc",
          sourcePositionId: "source-pos-1",
          leaderMarket: "ETH",
          pacificaOrderId: "pending",
        }),
      }),
    );
    expect(mocks.insertReturning.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.openCopyOrder.mock.invocationCallOrder[0],
    );
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "confirmed",
        meta: expect.objectContaining({
          sourceType: "whale",
          pacificaOrderId: "order-1",
          userEntryPrice: 2010.5,
          sourceEntryPriceAtCopy: 2000,
        }),
      }),
    );
    expect(mocks.reserveTailOnMarket).toHaveBeenCalledWith("user-1", "ETH");
    expect(mocks.releaseTailReservation).toHaveBeenCalledWith("user-1", "ETH");
    await expect(response.json()).resolves.toEqual({
      phase: "open",
      betId: "bet-1",
      fill: {
        orderId: "order-1",
        avgFillPrice: "2010.50",
        filledAmount: "0.025",
        side: "bid",
      },
      source: {
        whaleId: "pacifica:abc",
        displayName: "Whale ABC",
        asset: "ETH",
        side: "long",
        leverage: 5,
        autoCloseOnSourceClose: true,
      },
    });
  });

  it("sizes the copy from current mark when it is available", async () => {
    mocks.getWhaleLivePositionById.mockResolvedValue(
      openPacificaSource({ currentMark: 2500 }),
    );

    const response = await POST(
      whaleRequest({
        positionId: "source-pos-1",
        stakeUsdc: 10,
        walletAddress: "wallet-1",
        autoCloseOnSourceClose: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.openCopyOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "ETH",
        side: "long",
        amountBase: "0.020",
      }),
    );
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          sourceEntryPriceAtCopy: 2000,
        }),
      }),
    );
  });

  it("sizes the copy from fetched mark when current mark is missing", async () => {
    mocks.getWhaleLivePositionById.mockResolvedValue(
      openPacificaSource({ currentMark: null }),
    );
    mocks.getMark.mockResolvedValue(2500);

    const response = await POST(
      whaleRequest({
        positionId: "source-pos-1",
        stakeUsdc: 10,
        walletAddress: "wallet-1",
        autoCloseOnSourceClose: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.getMark).toHaveBeenCalledWith("ETH");
    expect(mocks.openCopyOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        amountBase: "0.020",
      }),
    );
  });

  it("rejects before reservation when no live price is available", async () => {
    mocks.getWhaleLivePositionById.mockResolvedValue(
      openPacificaSource({ currentMark: null }),
    );
    mocks.getMark.mockResolvedValue(null);

    const response = await POST(
      whaleRequest({
        positionId: "source-pos-1",
        stakeUsdc: 10,
        walletAddress: "wallet-1",
        autoCloseOnSourceClose: true,
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Live price is unavailable for ETH",
    });
    expect(mocks.reserveTailOnMarket).not.toHaveBeenCalled();
    expect(mocks.openCopyOrder).not.toHaveBeenCalled();
  });

  it.each(["hidden", "retired"])(
    "rejects %s whales before trading",
    async (whaleStatus) => {
      mocks.getWhaleLivePositionById.mockResolvedValue(
        openPacificaSource({ whaleStatus }),
      );

      const response = await POST(
        whaleRequest({
          positionId: "source-pos-1",
          stakeUsdc: 10,
          walletAddress: "wallet-1",
          autoCloseOnSourceClose: true,
        }),
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: "whale is not active",
      });
      expect(mocks.openCopyOrder).not.toHaveBeenCalled();
    },
  );

  it("rejects when the tail reservation cannot be acquired", async () => {
    mocks.reserveTailOnMarket.mockResolvedValue(false);

    const response = await POST(
      whaleRequest({
        positionId: "source-pos-1",
        stakeUsdc: 10,
        walletAddress: "wallet-1",
        autoCloseOnSourceClose: true,
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "you already have an open ETH tail - close it first",
    });
    expect(mocks.reserveTailOnMarket).toHaveBeenCalledWith("user-1", "ETH");
    expect(mocks.openCopyOrder).not.toHaveBeenCalled();
    expect(mocks.releaseTailReservation).not.toHaveBeenCalled();
  });

  it("returns prepare error when pending ledger insert returns no row", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.insertReturning.mockResolvedValue([]);

    try {
      const response = await POST(
        whaleRequest({
          positionId: "source-pos-1",
          stakeUsdc: 10,
          walletAddress: "wallet-1",
          autoCloseOnSourceClose: true,
        }),
      );

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({
        error: "Could not prepare whale copy bet",
      });
      expect(mocks.releaseTailReservation).toHaveBeenCalledWith("user-1", "ETH");
      expect(mocks.openCopyOrder).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("compensates when confirmed ledger update throws after open", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.updateReturning.mockRejectedValueOnce(new Error("update failed"));

    try {
      const response = await POST(
        whaleRequest({
          positionId: "source-pos-1",
          stakeUsdc: 10,
          walletAddress: "wallet-1",
          autoCloseOnSourceClose: true,
        }),
      );

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({
        error: "Could not confirm whale copy bet",
      });
      expect(mocks.openCopyOrder).toHaveBeenCalled();
      expect(mocks.closeCopyOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: "ETH",
          positionSide: "long",
          amountBase: "0.025",
        }),
      );
      expect(mocks.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
        }),
      );
      expect(mocks.releaseTailReservation).toHaveBeenCalledWith("user-1", "ETH");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("compensates when confirmed ledger update returns no row", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.updateReturning.mockResolvedValue([]);

    try {
      const response = await POST(
        whaleRequest({
          positionId: "source-pos-1",
          stakeUsdc: 10,
          walletAddress: "wallet-1",
          autoCloseOnSourceClose: true,
        }),
      );

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({
        error: "Could not confirm whale copy bet",
      });
      expect(mocks.openCopyOrder).toHaveBeenCalled();
      expect(mocks.closeCopyOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: "ETH",
          positionSide: "long",
          amountBase: "0.025",
        }),
      );
      expect(mocks.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
        }),
      );
      expect(mocks.releaseTailReservation).toHaveBeenCalledWith("user-1", "ETH");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps reservation when compensation close fails after confirm update failure", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.updateReturning.mockRejectedValueOnce(new Error("update failed"));
    mocks.closeCopyOrder.mockRejectedValue(new Error("close failed"));

    try {
      const response = await POST(
        whaleRequest({
          positionId: "source-pos-1",
          stakeUsdc: 10,
          walletAddress: "wallet-1",
          autoCloseOnSourceClose: true,
        }),
      );

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({
        error:
          "Whale copy opened but could not be recorded or auto-closed. Manual review required.",
      });
      expect(mocks.closeCopyOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: "ETH",
          positionSide: "long",
          amountBase: "0.025",
        }),
      );
      expect(mocks.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "manual_review",
        }),
      );
      expect(mocks.blockTailReservation).toHaveBeenCalledWith("user-1", "ETH");
      expect(mocks.releaseTailReservation).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        "[bet/whale] compensation close failed:",
        expect.any(Error),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("releases the tail reservation when Pacifica order opening fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mocks.openCopyOrder.mockRejectedValue(new Error("network down"));
    mocks.releaseTailReservation.mockRejectedValue(new Error("cleanup failed"));

    try {
      const response = await POST(
        whaleRequest({
          positionId: "source-pos-1",
          stakeUsdc: 10,
          walletAddress: "wallet-1",
          autoCloseOnSourceClose: true,
        }),
      );

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({
        error: "Pacifica order failed: Error: network down",
      });
      expect(mocks.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
        }),
      );
      expect(mocks.reserveTailOnMarket).toHaveBeenCalledWith("user-1", "ETH");
      expect(mocks.releaseTailReservation).toHaveBeenCalledWith("user-1", "ETH");
      expect(consoleWarn).toHaveBeenCalledWith(
        "[bet/whale] reservation cleanup failed:",
        expect.any(Error),
      );
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  it("still returns open when post-insert reservation release fails", async () => {
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mocks.releaseTailReservation.mockRejectedValue(new Error("cleanup failed"));

    try {
      const response = await POST(
        whaleRequest({
          positionId: "source-pos-1",
          stakeUsdc: 10,
          walletAddress: "wallet-1",
          autoCloseOnSourceClose: true,
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        phase: "open",
        betId: "bet-1",
      });
      expect(mocks.updateReturning).toHaveBeenCalled();
      expect(consoleWarn).toHaveBeenCalledWith(
        "[bet/whale] reservation cleanup failed:",
        expect.any(Error),
      );
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it("rejects stale whale positions before trading", async () => {
    mocks.getWhaleLivePositionById.mockResolvedValue(
      openPacificaSource({
        lastSeenAt: new Date("2026-05-23T11:56:00.000Z"),
      }),
    );

    const response = await POST(
      whaleRequest({
        positionId: "source-pos-1",
        stakeUsdc: 10,
        walletAddress: "wallet-1",
        autoCloseOnSourceClose: true,
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "whale position is stale",
    });
    expect(mocks.openCopyOrder).not.toHaveBeenCalled();
  });

  it("rejects non-Pacifica whale sources", async () => {
    mocks.getWhaleLivePositionById.mockResolvedValue(
      openPacificaSource({ source: "hyperliquid" }),
    );

    const response = await POST(
      whaleRequest({
        positionId: "source-pos-1",
        stakeUsdc: 10,
        walletAddress: "wallet-1",
        autoCloseOnSourceClose: true,
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "only Pacifica whale copying is supported",
    });
    expect(mocks.openCopyOrder).not.toHaveBeenCalled();
  });
});
