import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
  PacificaFundingRateLimitError: class PacificaFundingRateLimitError extends Error {
    retryAfterMs = 5000;

    constructor(public cause: unknown) {
      super("rate limited");
      this.name = "PacificaFundingRateLimitError";
    }
  },
  InsufficientAppFundsError: class InsufficientAppFundsError extends Error {
    constructor(public additionalUsdc: number) {
      super(`Add $${additionalUsdc.toFixed(2)} more USDC to trade.`);
      this.name = "InsufficientAppFundsError";
    }
  },
  isPacificaFundingRateLimitError: vi.fn((err: unknown) =>
    /HTTP 429|rate.?limit/i.test(String(err)),
  ),
  verifyPrivyRequest: vi.fn(),
  ensureUser: vi.fn(),
  getAgentWallet: vi.fn(),
  clampLeverageForNotional: vi.fn(),
  getMarketBySymbol: vi.fn(),
  openCopyOrder: vi.fn(),
  planOnboarding: vi.fn(),
  planPacificaDepositTopUp: vi.fn(),
  fetchOpenPositionForBot: vi.fn(),
  getBot: vi.fn(),
  hasOpenTailOnMarket: vi.fn(),
  returning: vi.fn(),
}));

vi.mock("@/lib/privy/server", () => ({
  verifyPrivyRequest: mocks.verifyPrivyRequest,
}));
vi.mock("@/lib/users/ensure", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/wallets/agent", () => ({
  getAgentWallet: mocks.getAgentWallet,
}));
vi.mock("@/lib/pacifica/markets", () => ({
  clampLeverageForNotional: mocks.clampLeverageForNotional,
  getMarketBySymbol: mocks.getMarketBySymbol,
}));
vi.mock("@/lib/pacifica/orders", () => ({
  openCopyOrder: mocks.openCopyOrder,
}));
vi.mock("@/lib/bets/onboard", () => ({
  planOnboarding: mocks.planOnboarding,
}));
vi.mock("@/lib/bets/funding", () => ({
  InsufficientAppFundsError: mocks.InsufficientAppFundsError,
  PacificaDepositPendingError: mocks.PacificaDepositPendingError,
  PacificaDepositSettlingError: mocks.PacificaDepositSettlingError,
  PacificaFundingRateLimitError: mocks.PacificaFundingRateLimitError,
  isPacificaFundingRateLimitError: mocks.isPacificaFundingRateLimitError,
  planPacificaDepositTopUp: mocks.planPacificaDepositTopUp,
}));
vi.mock("@/lib/bots/paper", () => ({
  fetchOpenPositionForBot: mocks.fetchOpenPositionForBot,
}));
vi.mock("@/lib/bots", () => ({ getBot: mocks.getBot }));
vi.mock("@/lib/bets/copy-guard", () => ({
  hasOpenTailOnMarket: mocks.hasOpenTailOnMarket,
}));
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: () => ({
        returning: mocks.returning,
      }),
    }),
  },
}));

import { POST } from "../../app/api/bet/bot/route";

describe("POST /api/bet/bot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyPrivyRequest.mockResolvedValue({ userId: "privy-user" });
    mocks.ensureUser.mockResolvedValue({
      id: "user-1",
      solanaPubkey: "wallet-1",
    });
    mocks.getBot.mockReturnValue({ id: "megalodon" });
    mocks.getAgentWallet.mockResolvedValue({
      mainPubkey: "wallet-1",
      agentPubkey: "agent-1",
      agentSecretKey: new Uint8Array(32),
    });
    mocks.hasOpenTailOnMarket.mockResolvedValue(false);
    mocks.clampLeverageForNotional.mockResolvedValue(10);
    mocks.getMarketBySymbol.mockResolvedValue({
      symbol: "ETH",
      lot_size: "0.0001",
    });
    mocks.planPacificaDepositTopUp.mockResolvedValue(null);
    mocks.openCopyOrder.mockResolvedValue({
      order_id: "order-1",
      avg_fill_price: "2118.51",
      filled_amount: "0.023601",
      side: "bid",
    });
    mocks.returning.mockResolvedValue([{ id: "bet-1" }]);
  });

  it("tails the exact paper position selected in the modal", async () => {
    mocks.fetchOpenPositionForBot.mockImplementation(
      async (_botId: string, positionId?: string) =>
        positionId === "eth-pos"
          ? {
              id: "eth-pos",
              asset: "ETH",
              side: "long",
              leverage: 10,
              entryMark: 2118.51,
            }
          : {
              id: "btc-pos",
              asset: "BTC",
              side: "long",
              leverage: 10,
              entryMark: 100000,
            },
    );

    const response = await POST(
      new Request("http://local.test/api/bet/bot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
        },
        body: JSON.stringify({
          botId: "megalodon",
          positionId: "eth-pos",
          market: "ETH",
          side: "long",
          leverage: 10,
          stakeUsdc: 5,
          walletAddress: "wallet-1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.fetchOpenPositionForBot).toHaveBeenCalledWith(
      "megalodon",
      "eth-pos",
    );
    expect(mocks.openCopyOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "ETH",
        side: "long",
        amountBase: "0.0236",
      }),
    );
  });

  it("marks credited-but-not-visible Pacifica deposits as retryable settling", async () => {
    mocks.fetchOpenPositionForBot.mockResolvedValue({
      id: "eth-pos",
      asset: "ETH",
      side: "long",
      leverage: 10,
      entryMark: 2118.51,
    });
    mocks.planPacificaDepositTopUp.mockRejectedValue(
      new mocks.PacificaDepositSettlingError(10),
    );

    const response = await POST(
      new Request("http://local.test/api/bet/bot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
        },
        body: JSON.stringify({
          botId: "megalodon",
          positionId: "eth-pos",
          market: "ETH",
          side: "long",
          leverage: 10,
          stakeUsdc: 5,
          walletAddress: "wallet-1",
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "settling 10",
      retryable: true,
      retryAfterMs: 2000,
    });
    expect(mocks.openCopyOrder).not.toHaveBeenCalled();
  });

  it("treats market metadata 429s as retryable instead of hard failing", async () => {
    mocks.fetchOpenPositionForBot.mockResolvedValue({
      id: "eth-pos",
      botId: "megalodon",
      asset: "ETH",
      side: "long",
      leverage: 10,
      entryMark: 2118.51,
    });
    mocks.getMarketBySymbol.mockRejectedValue(
      new Error("Pacifica GET /info failed: HTTP 429"),
    );

    const response = await POST(
      new Request("http://local.test/api/bet/bot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
        },
        body: JSON.stringify({
          botId: "megalodon",
          positionId: "eth-pos",
          market: "ETH",
          side: "long",
          leverage: 10,
          stakeUsdc: 10,
          walletAddress: "wallet-1",
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Market data is busy. Retrying shortly.",
      retryable: true,
      retryAfterMs: expect.any(Number),
    });
    expect(mocks.planPacificaDepositTopUp).not.toHaveBeenCalled();
    expect(mocks.openCopyOrder).not.toHaveBeenCalled();
  });
});
