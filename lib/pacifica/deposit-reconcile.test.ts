import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccountBalanceHistory: vi.fn(),
  getConnection: vi.fn(),
}));

vi.mock("@/lib/pacifica/client", () => ({
  getAccountBalanceHistory: mocks.getAccountBalanceHistory,
}));
vi.mock("@/lib/solana/balance", () => ({
  getConnection: mocks.getConnection,
}));

import { findUncreditedPacificaDeposits } from "./deposit-reconcile";

const ACCOUNT = "CSB3EXnGFRfoSNNUEpBme2a88wajac6dCMFzahW8vZ11";
const PACIFICA_PROGRAM_ID = "PCFA5iYgmqK6MqPhWNKg7Yv7auX7VZ4Cx7T1eJyrAMH";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NOW_MS = Date.parse("2026-05-26T11:25:00.000Z");

function txForDeposit(amountUsdc: number) {
  return {
    transaction: {
      message: {
        accountKeys: [
          { pubkey: { toBase58: () => PACIFICA_PROGRAM_ID } },
        ],
      },
    },
    meta: {
      preTokenBalances: [
        {
          accountIndex: 1,
          mint: USDC_MINT,
          owner: ACCOUNT,
          uiTokenAmount: { amount: String(Math.round(amountUsdc * 1_000_000)) },
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
  };
}

describe("findUncreditedPacificaDeposits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns on-chain Pacifica deposits missing from Pacifica balance history", async () => {
    mocks.getAccountBalanceHistory.mockResolvedValue([
      {
        amount: "10",
        balance: "10",
        pending_balance: "0",
        event_type: "deposit",
        created_at: Date.parse("2026-05-25T17:37:12.000Z"),
      },
    ]);
    mocks.getConnection.mockReturnValue({
      getSignaturesForAddress: vi.fn().mockResolvedValue([
        {
          signature: "pending-sig",
          blockTime: Date.parse("2026-05-26T11:12:39.000Z") / 1000,
          err: null,
        },
        {
          signature: "credited-sig",
          blockTime: Date.parse("2026-05-25T17:37:05.000Z") / 1000,
          err: null,
        },
      ]),
      getParsedTransaction: vi.fn(async (signature: string) =>
        signature === "pending-sig" ? txForDeposit(4.306925) : txForDeposit(10),
      ),
    });

    await expect(
      findUncreditedPacificaDeposits({
        account: ACCOUNT,
        nowMs: NOW_MS,
      }),
    ).resolves.toEqual({
      totalUsdc: 4.306925,
      deposits: [
        {
          amountUsdc: 4.306925,
          signature: "pending-sig",
          createdAt: "2026-05-26T11:12:39.000Z",
        },
      ],
    });
  });
});
