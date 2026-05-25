import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
}));

vi.mock("@/lib/solana/balance", () => ({
  getConnection: mocks.getConnection,
}));

import { buildDepositTx, InsufficientWalletUsdcError } from "./deposit";

const USER_PUBKEY = new PublicKey("CSB3EXnGFRfoSNNUEpBme2a88wajac6dCMFzahW8vZ11");

describe("Pacifica deposit transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnection.mockReturnValue({
      getTokenAccountBalance: vi
        .fn()
        .mockResolvedValue({ value: { amount: "50000000" } }),
      getLatestBlockhash: vi
        .fn()
        .mockResolvedValue({ blockhash: "11111111111111111111111111111111" }),
    });
  });

  it("builds an unsigned user-payer transaction for Privy sponsored send", async () => {
    const { transactionB64 } = await buildDepositTx({
      userPubkey: USER_PUBKEY,
      amountUsdc: 10,
    });

    const tx = VersionedTransaction.deserialize(
      Buffer.from(transactionB64, "base64"),
    );

    expect(tx.message.staticAccountKeys[0].toBase58()).toBe(
      USER_PUBKEY.toBase58(),
    );
    expect(tx.signatures.every((sig) => sig.every((byte) => byte === 0))).toBe(
      true,
    );
  });

  it("still rejects deposits larger than wallet USDC", async () => {
    mocks.getConnection.mockReturnValue({
      getTokenAccountBalance: vi
        .fn()
        .mockResolvedValue({ value: { amount: "1000000" } }),
      getLatestBlockhash: vi
        .fn()
        .mockResolvedValue({ blockhash: "11111111111111111111111111111111" }),
    });

    await expect(
      buildDepositTx({ userPubkey: USER_PUBKEY, amountUsdc: 10 }),
    ).rejects.toBeInstanceOf(InsufficientWalletUsdcError);
  });
});
