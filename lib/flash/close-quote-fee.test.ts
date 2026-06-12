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

describe("trigger collateral floor", () => {
  it("rejects below $10 with an honest message, passes at/above", async () => {
    const { assertTriggerCollateral, TRIGGER_MIN_COLLATERAL_USD, FlashPerpsError } =
      await import("./perps");
    expect(TRIGGER_MIN_COLLATERAL_USD).toBe(10);
    expect(() => assertTriggerCollateral(0.99)).toThrowError(
      /at least \$10 collateral.*\$0\.99/,
    );
    try {
      assertTriggerCollateral(7.48);
    } catch (e) {
      expect(e).toBeInstanceOf(FlashPerpsError);
      expect((e as InstanceType<typeof FlashPerpsError>).code).toBe("InvalidTrigger");
    }
    expect(() => assertTriggerCollateral(10)).not.toThrow();
    expect(() => assertTriggerCollateral(443.65)).not.toThrow();
  });
});
