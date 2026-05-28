import { describe, expect, it } from "vitest";

import { flashStakeUsdFromPosition } from "./position-value";

describe("flashStakeUsdFromPosition", () => {
  it("derives the user stake from notional size and leverage", () => {
    expect(
      flashStakeUsdFromPosition({
        sizeUsd: 1000,
        leverage: 100,
        collateralUsd: 9.5,
      }),
    ).toBe(10);
  });

  it("falls back to posted collateral when leverage is unavailable", () => {
    expect(
      flashStakeUsdFromPosition({
        sizeUsd: 1000,
        collateralUsd: 9.5,
      }),
    ).toBe(9.5);
  });
});
