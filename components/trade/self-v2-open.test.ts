import { describe, expect, it, vi } from "vitest";
import {
  buildSelfV2OpenBody,
  buildSelfV2CloseBody,
  synthFlashV2Position,
} from "./self-v2-open";
import { signAndSubmitErTx } from "./er-submit";

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
  it("signs (sign-only) then broadcasts raw to the ER with skipPreflight", async () => {
    const signed = new Uint8Array([7, 7]);
    const sign = vi.fn(async () => signed);
    const sendRawTransaction = vi.fn(async () => "ERSIG");
    const makeConnection = vi.fn(() => ({ sendRawTransaction }));

    const sig = await signAndSubmitErTx({
      txBytes: new Uint8Array([1]),
      sign,
      makeConnection,
      erRpc: "https://er.example",
    });

    expect(sig).toBe("ERSIG");
    expect(sign).toHaveBeenCalledWith(new Uint8Array([1]));
    expect(makeConnection).toHaveBeenCalledWith("https://er.example");
    expect(sendRawTransaction).toHaveBeenCalledWith(signed, {
      skipPreflight: true,
      maxRetries: 3,
    });
  });

  it("propagates a signer error (e.g. wallet not ready) without broadcasting", async () => {
    const sendRawTransaction = vi.fn();
    await expect(
      signAndSubmitErTx({
        txBytes: new Uint8Array([1]),
        sign: async () => {
          throw new Error("Wallet not ready");
        },
        makeConnection: () => ({ sendRawTransaction }),
      }),
    ).rejects.toThrow("Wallet not ready");
    expect(sendRawTransaction).not.toHaveBeenCalled();
  });
});
