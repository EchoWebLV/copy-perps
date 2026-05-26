import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildDepositTx: vi.fn(),
  getWalletUsdcBalance: vi.fn(),
  getAgentWallet: vi.fn(),
  getAgentWalletRow: vi.fn(),
  createPendingAgentWallet: vi.fn(),
  generateAgentKeypair: vi.fn(),
  markAgentWalletBound: vi.fn(),
}));

vi.mock("@/lib/pacifica/deposit", () => ({
  buildDepositTx: mocks.buildDepositTx,
  getWalletUsdcBalance: mocks.getWalletUsdcBalance,
}));
vi.mock("@/lib/wallets/agent", () => ({
  generateAgentKeypair: mocks.generateAgentKeypair,
  getAgentWallet: mocks.getAgentWallet,
  getAgentWalletRow: mocks.getAgentWalletRow,
  createPendingAgentWallet: mocks.createPendingAgentWallet,
  markAgentWalletBound: mocks.markAgentWalletBound,
}));

import { planOnboarding } from "./onboard";

const ACCOUNT = "CSB3EXnGFRfoSNNUEpBme2a88wajac6dCMFzahW8vZ11";

describe("planOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentWallet.mockResolvedValue(null);
    mocks.getAgentWalletRow.mockResolvedValue(null);
    mocks.generateAgentKeypair.mockReturnValue({
      publicKeyB58: "agent-1",
      seed: new Uint8Array(32),
    });
    mocks.createPendingAgentWallet.mockResolvedValue(undefined);
    mocks.getWalletUsdcBalance.mockResolvedValue(13.22);
    mocks.buildDepositTx.mockResolvedValue({ transactionB64: "tx" });
  });

  it("uses the wallet USDC balance for first-time trade setup", async () => {
    await expect(
      planOnboarding({
        userId: "user-1",
        userMainPubkey: ACCOUNT,
        desiredStakeUsdc: 5,
        leverage: 20,
      }),
    ).resolves.toMatchObject({
      alreadyOnboarded: false,
      bindAgentPubkey: "agent-1",
      depositTransactionB64: "tx",
      initialDepositUsdc: 13.22,
    });
    expect(mocks.buildDepositTx).toHaveBeenCalledWith({
      userPubkey: expect.objectContaining({}),
      amountUsdc: 13.22,
    });
  });
});
