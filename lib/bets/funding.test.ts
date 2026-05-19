import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildDepositTx: vi.fn(),
  getAccountInfo: vi.fn(),
  getConnection: vi.fn(),
}));

vi.mock("@/lib/pacifica/deposit", () => ({
  buildDepositTx: mocks.buildDepositTx,
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

describe("Pacifica funding math", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sizes first deposit from the selected stake instead of a hidden buffer", () => {
    expect(
      requiredPacificaCollateralUsdc({ stakeUsdc: 5, leverage: 10 }),
    ).toBe(5.12);
    expect(requiredPacificaDepositUsdc({ stakeUsdc: 5, leverage: 10 })).toBe(
      PACIFICA_MIN_DEPOSIT_USDC,
    );
  });

  it("tops up the shortfall while obeying Pacifica's minimum deposit", () => {
    expect(
      pacificaDepositTopUpUsdc({
        availableToSpendUsdc: 3,
        stakeUsdc: 5,
        leverage: 10,
      }),
    ).toBe(PACIFICA_MIN_DEPOSIT_USDC);

    expect(
      pacificaDepositTopUpUsdc({
        availableToSpendUsdc: 6,
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
    mocks.getAccountInfo.mockResolvedValue({ available_to_spend: "0" });
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
});
