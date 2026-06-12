import { BN } from "@coral-xyz/anchor";
import { describe, expect, it } from "vitest";
import { CLOSE_QUOTE_FEE_DECIMALS, closeQuoteFeeToUsd6 } from "./perps";

describe("close-quote fee scaling", () => {
  // Verified on-chain 2026-06-12: getClosePositionQuote returned
  // fees = 226_019_104 for a ~$2.26 close fee on a $329 SOL position —
  // i.e. 8 decimals, NOT the 6 the quote's other USD fields use. Feeding
  // it un-rescaled into getTriggerPriceFromRoiSync inflated the fee 100×,
  // swamped the ROI term, and made every TP/SL compute to ≈ entry price
  // (Flash rejects: 6049 InvalidStopLossPrice / 6034 MinCollateral).
  it("is declared as 8 decimals", () => {
    expect(CLOSE_QUOTE_FEE_DECIMALS).toBe(8);
  });

  it("rescales the on-chain regression value to 6dp USD", () => {
    expect(closeQuoteFeeToUsd6(new BN(226_019_104)).toString()).toBe(
      "2260191",
    );
  });

  it("zero stays zero", () => {
    expect(closeQuoteFeeToUsd6(new BN(0)).toString()).toBe("0");
  });
});
