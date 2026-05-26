import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildDepositTx: vi.fn(),
  getWalletUsdcBalance: vi.fn(),
  getAccountInfo: vi.fn(),
  getConnection: vi.fn(),
}));

vi.mock("@/lib/pacifica/deposit", () => ({
  buildDepositTx: mocks.buildDepositTx,
  getWalletUsdcBalance: mocks.getWalletUsdcBalance,
}));
vi.mock("@/lib/pacifica/client", () => ({
  getAccountInfo: mocks.getAccountInfo,
}));
vi.mock("@/lib/solana/balance", () => ({
  getConnection: mocks.getConnection,
}));

import {
  PACIFICA_MIN_DEPOSIT_USDC,
  PacificaDepositSettlingError,
  PacificaFundingRateLimitError,
  classifyRecentPacificaDeposit,
  planPacificaDepositTopUp,
  requiredPacificaDepositUsdc,
  requiredPacificaCollateralUsdc,
  pacificaDepositTopUpUsdc,
} from "./funding";

const ACCOUNT = "CSB3EXnGFRfoSNNUEpBme2a88wajac6dCMFzahW8vZ11";
const PACIFICA_PROGRAM_ID = "PCFA5iYgmqK6MqPhWNKg7Yv7auX7VZ4Cx7T1eJyrAMH";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function mockRecentDeposit(amountUsdc: number) {
  mocks.getConnection.mockReturnValue({
    getSignaturesForAddress: vi.fn().mockResolvedValue([
      {
        signature: "sig",
        blockTime: Math.floor(Date.now() / 1000),
        err: null,
      },
    ]),
    getParsedTransaction: vi.fn().mockResolvedValue({
      transaction: {
        message: {
          accountKeys: [
            {
              pubkey: {
                toBase58: () => PACIFICA_PROGRAM_ID,
              },
            },
          ],
        },
      },
      meta: {
        preTokenBalances: [
          {
            accountIndex: 1,
            mint: USDC_MINT,
            owner: ACCOUNT,
            uiTokenAmount: { amount: String(amountUsdc * 1_000_000) },
          },
        ],
        postTokenBalances: [
          {
            accountIndex: 1,
            mint: USDC_MINT,
            owner: ACCOUNT,
            uiTokenAmount: { amount: "0" },
          },
        ],
      },
    }),
  });
}

function mockNoRecentDeposit() {
  mocks.getConnection.mockReturnValue({
    getSignaturesForAddress: vi.fn().mockResolvedValue([]),
    getParsedTransaction: vi.fn(),
  });
}

describe("Pacifica funding math", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWalletUsdcBalance.mockResolvedValue(10);
  });

  it("sizes first deposit from the selected stake instead of a hidden buffer", () => {
    expect(
      requiredPacificaCollateralUsdc({ stakeUsdc: 5, leverage: 10 }),
    ).toBe(5);
    expect(requiredPacificaDepositUsdc({ stakeUsdc: 5, leverage: 10 })).toBe(
      PACIFICA_MIN_DEPOSIT_USDC,
    );
  });

  it("sizes top-ups from the collateral shortfall instead of a fresh-deposit minimum", () => {
    expect(
      pacificaDepositTopUpUsdc({
        availableToSpendUsdc: 3,
        stakeUsdc: 5,
        leverage: 10,
      }),
    ).toBe(2);

    expect(
      pacificaDepositTopUpUsdc({
        availableToSpendUsdc: 5,
        stakeUsdc: 5,
        leverage: 10,
      }),
    ).toBe(0);
  });

  it("classifies recent deposits against Pacifica's bridge minimum", () => {
    expect(
      classifyRecentPacificaDeposit({ recentDepositUsdc: 0 }),
    ).toBe("none");

    expect(
      classifyRecentPacificaDeposit({ recentDepositUsdc: 5.12 }),
    ).toBe("below_minimum");

    expect(
      classifyRecentPacificaDeposit({ recentDepositUsdc: 10 }),
    ).toBe("settling");
  });

  it("does not request another deposit while a valid recent deposit is settling", async () => {
    mocks.getAccountInfo.mockResolvedValue({
      available_to_spend: "0",
      account_equity: "0",
      balance: "0",
    });
    mockRecentDeposit(10);

    await expect(
      planPacificaDepositTopUp({
        userMainPubkey: ACCOUNT,
        stakeUsdc: 5,
        leverage: 10,
      }),
    ).rejects.toBeInstanceOf(PacificaDepositSettlingError);
    expect(mocks.buildDepositTx).not.toHaveBeenCalled();
  });

  it("uses credited Pacifica funds even when a previous deposit is recent", async () => {
    mocks.getAccountInfo.mockResolvedValue({
      available_to_spend: "5.011944",
      account_equity: "9.996267",
      balance: "9.944283",
    });
    mockRecentDeposit(10);

    await expect(
      planPacificaDepositTopUp({
        userMainPubkey: ACCOUNT,
        stakeUsdc: 5,
        leverage: 50,
      }),
    ).resolves.toBeNull();
    expect(mocks.buildDepositTx).not.toHaveBeenCalled();
    expect(mocks.getConnection).not.toHaveBeenCalled();
  });

  it("plans a top-up instead of calling credited funds still settling", async () => {
    mocks.getAccountInfo.mockResolvedValue({
      available_to_spend: "5",
      account_equity: "10",
      balance: "10",
    });
    mocks.buildDepositTx.mockResolvedValue({ transactionB64: "tx" });
    mockNoRecentDeposit();

    await expect(
      planPacificaDepositTopUp({
        userMainPubkey: ACCOUNT,
        stakeUsdc: 10,
        leverage: 5,
      }),
    ).resolves.toEqual({
      depositTransactionB64: "tx",
      initialDepositUsdc: 10,
      availablePacificaUsdc: 5,
    });
    expect(mocks.getConnection).not.toHaveBeenCalled();
  });

  it("deposits only the Pacifica minimum when a small trade top-up is needed", async () => {
    mocks.getAccountInfo.mockResolvedValue({
      available_to_spend: "3.97",
      account_equity: "8.92",
      balance: "8.92",
    });
    mocks.getWalletUsdcBalance.mockResolvedValue(13.22);
    mocks.buildDepositTx.mockResolvedValue({ transactionB64: "tx" });
    mockNoRecentDeposit();

    await expect(
      planPacificaDepositTopUp({
        userMainPubkey: ACCOUNT,
        stakeUsdc: 5,
        leverage: 20,
      }),
    ).resolves.toEqual({
      depositTransactionB64: "tx",
      initialDepositUsdc: PACIFICA_MIN_DEPOSIT_USDC,
      availablePacificaUsdc: 3.97,
    });
    expect(mocks.buildDepositTx).toHaveBeenCalledWith({
      userPubkey: expect.objectContaining({}),
      amountUsdc: PACIFICA_MIN_DEPOSIT_USDC,
    });
    expect(mocks.getConnection).not.toHaveBeenCalled();
  });

  it("does not submit sub-minimum Pacifica deposits from a partially funded account", async () => {
    mocks.getAccountInfo.mockResolvedValue({
      available_to_spend: "3.97",
      account_equity: "8.92",
      balance: "8.92",
    });
    mocks.getWalletUsdcBalance.mockResolvedValue(4.31);
    mocks.buildDepositTx.mockResolvedValue({ transactionB64: "tx" });
    mockNoRecentDeposit();

    await expect(
      planPacificaDepositTopUp({
        userMainPubkey: ACCOUNT,
        stakeUsdc: 5,
        leverage: 20,
      }),
    ).rejects.toThrow("Add $5.69 more USDC to trade.");
    expect(mocks.buildDepositTx).not.toHaveBeenCalled();
    expect(mocks.getConnection).not.toHaveBeenCalled();
  });

  it("returns a plain insufficient-funds error when wallet USDC is below a larger top-up", async () => {
    mocks.getAccountInfo.mockResolvedValue({
      available_to_spend: "0",
      account_equity: "0",
      balance: "0",
    });
    mocks.getWalletUsdcBalance.mockResolvedValue(20);
    mocks.buildDepositTx.mockResolvedValue({ transactionB64: "tx" });
    mockNoRecentDeposit();

    await expect(
      planPacificaDepositTopUp({
        userMainPubkey: ACCOUNT,
        stakeUsdc: 50,
        leverage: 5,
      }),
    ).rejects.toThrow("Add $30.00 more USDC to trade.");
    expect(mocks.buildDepositTx).not.toHaveBeenCalled();
  });

  it("does not request another deposit when Pacifica account reads are rate-limited", async () => {
    mocks.getAccountInfo.mockRejectedValue(
      new Error(
        `Pacifica GET /account?account=${ACCOUNT} failed: HTTP 429`,
      ),
    );
    mockNoRecentDeposit();

    await expect(
      planPacificaDepositTopUp({
        userMainPubkey: ACCOUNT,
        stakeUsdc: 5,
        leverage: 10,
      }),
    ).rejects.toBeInstanceOf(PacificaFundingRateLimitError);
    expect(mocks.buildDepositTx).not.toHaveBeenCalled();
  });
});
