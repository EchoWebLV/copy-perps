import { describe, expect, it, vi } from "vitest";
import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { sendDepositWithSponsorFallback } from "./deposit-signing";

function privySponsorError() {
  const err = new Error("Failed to connect to wallet") as Error & {
    cause?: Error;
  };
  err.cause = new Error(
    "Sponsoring transactions is only supported for wallets on the TEE stack",
  );
  return err;
}

describe("sendDepositWithSponsorFallback", () => {
  it("retries an unsupported sponsored send without sponsorship", async () => {
    const signAndSendTransaction = vi
      .fn()
      .mockRejectedValueOnce(privySponsorError())
      .mockResolvedValueOnce({ signature: "normal-send-signature" });
    const onSponsorFallback = vi.fn();

    const result = await sendDepositWithSponsorFallback({
      transaction: new Uint8Array([1, 2, 3]),
      wallet: { address: "wallet-1" } as ConnectedStandardSolanaWallet,
      signAndSendTransaction,
      onSponsorFallback,
    });

    expect(result).toEqual({
      signature: "normal-send-signature",
      sponsored: false,
    });
    expect(signAndSendTransaction).toHaveBeenNthCalledWith(1, {
      transaction: new Uint8Array([1, 2, 3]),
      wallet: { address: "wallet-1" },
      options: { sponsor: true },
    });
    expect(signAndSendTransaction).toHaveBeenNthCalledWith(2, {
      transaction: new Uint8Array([1, 2, 3]),
      wallet: { address: "wallet-1" },
    });
    expect(onSponsorFallback).toHaveBeenCalledWith(expect.any(Error));
  });

  it("retries when Privy hides the sponsored send failure behind a wallet connection error", async () => {
    const signAndSendTransaction = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failed to connect to wallet"))
      .mockResolvedValueOnce({ signature: "wallet-gas-signature" });

    const result = await sendDepositWithSponsorFallback({
      transaction: new Uint8Array([4, 5, 6]),
      wallet: { address: "wallet-1" } as ConnectedStandardSolanaWallet,
      signAndSendTransaction,
    });

    expect(result).toEqual({
      signature: "wallet-gas-signature",
      sponsored: false,
    });
    expect(signAndSendTransaction).toHaveBeenCalledTimes(2);
  });
});
