import { describe, expect, it, vi } from "vitest";
import { flashV2Venue } from "./venue";

describe("flashV2Venue", () => {
  it("openPosition builds an ER-layer unsigned tx with mapped params", async () => {
    const fakeTx = {} as never;
    const postBuilder = vi.fn(async () => ({ tx: fakeTx, raw: { entryPriceUi: 150 } }));
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
    expect(out.quote.entryPriceUi).toBe(150);
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
});
