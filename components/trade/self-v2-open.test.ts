import { describe, expect, it, vi } from "vitest";
import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  buildSelfV2OpenBody,
  buildSelfV2CloseBody,
  synthFlashV2Position,
} from "./self-v2-open";
import { signAndSubmitErTx } from "./er-submit";

// A real serialized (unsigned) v0 tx with a placeholder blockhash, so the helper
// can deserialize it and refresh the blockhash.
function makeTxBytes(): Uint8Array {
  const msg = new TransactionMessage({
    payerKey: Keypair.generate().publicKey,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [],
  }).compileToV0Message();
  return new VersionedTransaction(msg).serialize();
}

describe("buildSelfV2OpenBody / buildSelfV2CloseBody", () => {
  it("builds the thin v2 open body (no mode/instant)", () => {
    expect(
      buildSelfV2OpenBody({
        market: "SOL",
        side: "long",
        stakeUsdc: 20,
        leverage: 10,
        walletAddress: "W",
      }),
    ).toEqual({ market: "SOL", side: "long", stakeUsdc: 20, leverage: 10, walletAddress: "W" });
  });

  it("builds the v2 close body keyed by market+side", () => {
    expect(buildSelfV2CloseBody({ market: "BTC", side: "short", walletAddress: "W" })).toEqual({
      market: "BTC",
      side: "short",
      walletAddress: "W",
    });
  });
});

describe("synthFlashV2Position", () => {
  it("synthesizes an optimistic position keyed flashv2:<market>:<side>", () => {
    const pos = synthFlashV2Position({
      market: "SOL",
      side: "long",
      stakeUsdc: 20,
      leverage: 10,
      quote: { entryPriceUi: 150, liquidationPriceUi: 100, feeUsdUi: 0.5 },
      nowMs: 1700,
    });
    expect(pos).toMatchObject({
      symbol: "SOL",
      side: "long",
      positionPubkey: "flashv2:SOL:long",
      entryPriceUsd: 150,
      markPriceUsd: 150,
      sizeUsd: 200, // 20 * 10
      collateralUsd: 20,
      leverage: 10,
      liquidationPriceUsd: 100,
      openFeeUsd: 0.5,
      openTime: 1700,
    });
  });

  it("tolerates a missing quote (entry unknown ⇒ 0, mark undefined)", () => {
    const pos = synthFlashV2Position({
      market: "ETH",
      side: "short",
      stakeUsdc: 5,
      leverage: 4,
      quote: null,
      nowMs: 1,
    });
    expect(pos.entryPriceUsd).toBe(0);
    expect(pos.markPriceUsd).toBeUndefined();
    expect(pos.sizeUsd).toBe(20);
  });
});

describe("signAndSubmitErTx", () => {
  // A valid 32-byte base58 string (a blockhash is encoded like a pubkey).
  const FRESH = Keypair.generate().publicKey.toBase58();

  it("refreshes the blockhash from the ER, signs, then broadcasts with skipPreflight", async () => {
    const signed = new Uint8Array([7, 7]);
    // Capture the bytes handed to the signer to confirm the blockhash was swapped.
    let signedMsgBlockhash = "";
    const sign = vi.fn(async (bytes: Uint8Array) => {
      signedMsgBlockhash = VersionedTransaction.deserialize(bytes).message
        .recentBlockhash;
      return signed;
    });
    const sendRawTransaction = vi.fn(async () => "ERSIG");
    const getLatestBlockhash = vi.fn(async () => ({ blockhash: FRESH }));
    const makeConnection = vi.fn(() => ({ getLatestBlockhash, sendRawTransaction }));

    const sig = await signAndSubmitErTx({
      txBytes: makeTxBytes(),
      sign,
      makeConnection,
      erRpc: "https://er.example",
    });

    expect(sig).toBe("ERSIG");
    expect(makeConnection).toHaveBeenCalledWith("https://er.example");
    expect(getLatestBlockhash).toHaveBeenCalled();
    // The tx the user signs carries the FRESH ER blockhash, not the builder's.
    expect(signedMsgBlockhash).toBe(FRESH);
    expect(sendRawTransaction).toHaveBeenCalledWith(signed, {
      skipPreflight: true,
      maxRetries: 3,
    });
  });

  it("propagates a signer error (e.g. wallet not ready) without broadcasting", async () => {
    const sendRawTransaction = vi.fn();
    await expect(
      signAndSubmitErTx({
        txBytes: makeTxBytes(),
        sign: async () => {
          throw new Error("Wallet not ready");
        },
        makeConnection: () => ({
          getLatestBlockhash: async () => ({ blockhash: FRESH }),
          sendRawTransaction,
        }),
      }),
    ).rejects.toThrow("Wallet not ready");
    expect(sendRawTransaction).not.toHaveBeenCalled();
  });
});
