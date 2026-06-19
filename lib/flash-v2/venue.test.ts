import { describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { flashV2Venue } from "./venue";
import { deriveSessionTokenV2 } from "./session";

describe("flashV2Venue", () => {
  it("openPosition builds an ER-layer unsigned tx with mapped params", async () => {
    const fakeTx = {} as never;
    // Real open-position response keys (newEntryPrice / newLiquidationPrice /
    // entryFee / youRecieveUsdUi), NOT the snapshot *Ui names.
    const postBuilder = vi.fn(async () => ({
      tx: fakeTx,
      raw: {
        newEntryPrice: 150,
        newLiquidationPrice: 90,
        entryFee: 1.25,
        youPayUsdUi: 25,
        youRecieveUsdUi: 123.5,
      },
    }));
    const venue = flashV2Venue({ postBuilder: postBuilder as never });
    const out = await venue.openPosition({
      owner: "owner1",
      symbol: "SOL",
      collateralUsd: 25,
      leverage: 5,
      side: "long",
      orderType: "market",
    });
    expect(out.unsigned.layer).toBe("er");
    expect(postBuilder).toHaveBeenCalledWith("/transaction-builder/open-position", {
      owner: "owner1",
      inputTokenSymbol: "USDC",
      outputTokenSymbol: "SOL",
      inputAmountUi: 25,
      leverage: 5,
      tradeType: "LONG",
      orderType: "MARKET",
    });
    // The blind `raw as Quote` cast would have left these undefined.
    expect(out.quote.entryPriceUi).toBe(150);
    expect(out.quote.liquidationPriceUi).toBe(90);
    expect(out.quote.feeUsdUi).toBe(1.25);
    expect(out.quote.youRecieveUsdUi).toBe(123.5);
  });

  it("closePosition routes to close-position on the ER layer (by symbol+side)", async () => {
    const fakeTx = {} as never;
    const postBuilder = vi.fn(async () => ({ tx: fakeTx, raw: {} }));
    const venue = flashV2Venue({ postBuilder: postBuilder as never });
    const out = await venue.closePosition({
      owner: "owner1",
      symbol: "SOL",
      side: "long",
      closeUsd: 10,
    });
    expect(out.unsigned.layer).toBe("er");
    expect(postBuilder).toHaveBeenCalledWith("/transaction-builder/close-position", {
      owner: "owner1",
      marketSymbol: "SOL",
      side: "LONG",
      inputUsdUi: 10,
      withdrawTokenSymbol: "USDC",
    });
  });

  it("openPosition with a valid session adds signer+sessionToken to the body", async () => {
    const owner = Keypair.generate().publicKey.toBase58();
    const signer = Keypair.generate().publicKey.toBase58();
    const sessionToken = deriveSessionTokenV2(owner, signer).toBase58();
    const postBuilder = vi.fn(async () => ({ tx: {} as never, raw: {} }));
    const venue = flashV2Venue({ postBuilder: postBuilder as never });
    await venue.openPosition({
      owner,
      symbol: "SOL",
      collateralUsd: 25,
      leverage: 5,
      side: "long",
      orderType: "market",
      session: { signer, sessionToken },
    });
    expect(postBuilder).toHaveBeenCalledWith(
      "/transaction-builder/open-position",
      expect.objectContaining({ owner, signer, sessionToken }),
    );
  });

  it("rejects a session whose token does not match owner+signer (no request sent)", async () => {
    const owner = Keypair.generate().publicKey.toBase58();
    const signer = Keypair.generate().publicKey.toBase58();
    const postBuilder = vi.fn(async () => ({ tx: {} as never, raw: {} }));
    const venue = flashV2Venue({ postBuilder: postBuilder as never });
    await expect(
      venue.closePosition({
        owner,
        symbol: "SOL",
        side: "long",
        closeUsd: 10,
        session: { signer, sessionToken: "11111111111111111111111111111111" },
      }),
    ).rejects.toThrow();
    expect(postBuilder).not.toHaveBeenCalled();
  });
});
