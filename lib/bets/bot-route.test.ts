import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyPrivyRequest: vi.fn(),
  ensureUser: vi.fn(),
  getAgentWallet: vi.fn(),
  clampLeverageForNotional: vi.fn(),
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
}));
vi.mock("@/lib/pacifica/orders", () => ({
  openCopyOrder: mocks.openCopyOrder,
}));
vi.mock("@/lib/bets/onboard", () => ({
  planOnboarding: mocks.planOnboarding,
}));
vi.mock("@/lib/bets/funding", () => ({
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
      }),
    );
  });
});
