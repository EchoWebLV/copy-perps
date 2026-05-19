import { describe, expect, it } from "vitest";
import { formatLotSizedAmount, lotSizedAmountFromNotional } from "./sizing";

describe("Pacifica order sizing", () => {
  it("floors ETH amount to the market lot size", () => {
    expect(formatLotSizedAmount(0.023732, "0.0001")).toBe("0.0237");
  });

  it("derives a lot-sized base amount from notional", () => {
    expect(
      lotSizedAmountFromNotional({
        notionalUsd: 50,
        price: 2116.86,
        lotSize: "0.0001",
      }),
    ).toBe("0.0236");
  });
});
