import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyPrivyRequest: vi.fn(),
  ensureUser: vi.fn(),
  getAgentWallet: vi.fn(),
  planOnboarding: vi.fn(),
  planPacificaDepositTopUp: vi.fn(),
  getMarketBySymbol: vi.fn(),
  clampLeverageForNotional: vi.fn(),
  getMark: vi.fn(),
  getPositions: vi.fn(),
  openCopyOrder: vi.fn(),
  closeCopyOrder: vi.fn(),
  PacificaDepositPendingError: class PacificaDepositPendingError extends Error {},
  PacificaDepositSettlingError: class PacificaDepositSettlingError extends Error {
    retryAfterMs = 2000;
  },
  PacificaFundingRateLimitError: class PacificaFundingRateLimitError extends Error {
    retryAfterMs = 5000;
  },
  InsufficientAppFundsError: class InsufficientAppFundsError extends Error {},
  isPacificaFundingRateLimitError: vi.fn((err: unknown) =>
    /HTTP 429|rate.?limit/i.test(String(err)),
  ),
}));

vi.mock("@/lib/privy/server", () => ({
  verifyPrivyRequest: mocks.verifyPrivyRequest,
}));
vi.mock("@/lib/users/ensure", () => ({
  ensureUser: mocks.ensureUser,
}));
vi.mock("@/lib/wallets/agent", () => ({
  getAgentWallet: mocks.getAgentWallet,
}));
vi.mock("@/lib/bets/onboard", () => ({
  planOnboarding: mocks.planOnboarding,
}));
vi.mock("@/lib/bets/funding", () => ({
  PacificaDepositPendingError: mocks.PacificaDepositPendingError,
  PacificaDepositSettlingError: mocks.PacificaDepositSettlingError,
  PacificaFundingRateLimitError: mocks.PacificaFundingRateLimitError,
  InsufficientAppFundsError: mocks.InsufficientAppFundsError,
  isPacificaFundingRateLimitError: mocks.isPacificaFundingRateLimitError,
  planPacificaDepositTopUp: mocks.planPacificaDepositTopUp,
}));
vi.mock("@/lib/pacifica/markets", () => ({
  getMarketBySymbol: mocks.getMarketBySymbol,
  clampLeverageForNotional: mocks.clampLeverageForNotional,
}));
vi.mock("@/lib/data/marks", () => ({
  getMark: mocks.getMark,
}));
vi.mock("@/lib/pacifica/client", () => ({
  getPositions: mocks.getPositions,
}));
vi.mock("@/lib/pacifica/orders", () => ({
  openCopyOrder: mocks.openCopyOrder,
  closeCopyOrder: mocks.closeCopyOrder,
}));

import { POST as OPEN } from "../../app/api/trade/perp/route";
import { POST as CLOSE } from "../../app/api/trade/perp/close/route";

function postRequest(path: string, body: unknown) {
  return new Request(`http://local.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer token",
    },
    body: JSON.stringify(body),
  });
}

describe("self perp trade routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mocks.getMarketBySymbol.mockResolvedValue({
      symbol: "ETH",
      lot_size: "0.001",
      max_leverage: 50,
    });
    mocks.clampLeverageForNotional.mockResolvedValue(50);
    mocks.getMark.mockResolvedValue(2000);
    mocks.getPositions.mockResolvedValue([]);
    mocks.planPacificaDepositTopUp.mockResolvedValue(null);
    mocks.openCopyOrder.mockResolvedValue({
      order_id: "order-1",
      avg_fill_price: "2001.50",
      filled_amount: "0.025",
      side: "bid",
    });
    mocks.closeCopyOrder.mockResolvedValue({
      order_id: "close-order-1",
      avg_fill_price: "2002.50",
      filled_amount: "0.025",
      side: "ask",
    });
  });

  it("opens a self-directed Pacifica perp using stake and leverage", async () => {
    const response = await OPEN(
      postRequest("/api/trade/perp", {
        market: "ETH",
        side: "long",
        stakeUsdc: 10,
        leverage: 5,
        walletAddress: "wallet-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.clampLeverageForNotional).toHaveBeenCalledWith("ETH", 50);
    expect(mocks.openCopyOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "ETH",
        side: "long",
        amountBase: "0.025",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      phase: "open",
      fill: {
        orderId: "order-1",
        avgFillPrice: "2001.50",
        filledAmount: "0.025",
        side: "bid",
      },
      trade: {
        market: "ETH",
        side: "long",
        leverage: 5,
        stakeUsdc: 10,
      },
    });
  });

  it("rejects self-trades that would merge with an existing wallet position", async () => {
    mocks.getPositions.mockResolvedValue([
      {
        symbol: "ETH",
        side: "bid",
        amount: "0.01",
        entry_price: "2000",
        margin: "0",
        funding: "0",
        isolated: false,
        liquidation_price: "1800",
        created_at: 1779730000000,
        updated_at: 1779730000000,
      },
    ]);

    const response = await OPEN(
      postRequest("/api/trade/perp", {
        market: "ETH",
        side: "short",
        stakeUsdc: 10,
        leverage: 5,
        walletAddress: "wallet-1",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "you already have an open ETH position - close it first",
    });
    expect(mocks.openCopyOrder).not.toHaveBeenCalled();
  });

  it("closes the matching live wallet perp position", async () => {
    mocks.getPositions.mockResolvedValue([
      {
        symbol: "ETH",
        side: "bid",
        amount: "0.025",
        entry_price: "2000",
        margin: "0",
        funding: "0",
        isolated: false,
        liquidation_price: "1800",
        created_at: 1779730000000,
        updated_at: 1779730000000,
      },
    ]);

    const response = await CLOSE(
      postRequest("/api/trade/perp/close", {
        market: "ETH",
        side: "long",
        walletAddress: "wallet-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.closeCopyOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "ETH",
        positionSide: "long",
        amountBase: "0.025",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      phase: "closed",
      fill: {
        orderId: "close-order-1",
        avgFillPrice: "2002.50",
        filledAmount: "0.025",
        side: "ask",
      },
    });
  });
});
