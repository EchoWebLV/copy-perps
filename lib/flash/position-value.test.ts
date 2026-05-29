import { describe, expect, it } from "vitest";

import { flashStakeUsdFromPosition, type FlashStakePosition } from "./position-value";

describe("flashStakeUsdFromPosition", () => {
  it("prefers the original entry cost when the Flash open quote is available", () => {
    expect(
      flashStakeUsdFromPosition({
        sizeUsd: 500,
        leverage: 515.463918,
        collateralUsd: 0.97,
        entryCostUsd: 1,
      } as FlashStakePosition & { entryCostUsd: number }),
    ).toBe(1);
  });

  it("derives the user stake from notional size and leverage", () => {
    expect(
      flashStakeUsdFromPosition({
        sizeUsd: 1000,
        leverage: 100,
        collateralUsd: 9.5,
      }),
    ).toBe(10);
  });

  it("recovers a $1 Flash stake from refreshed effective leverage after fees", () => {
    expect(
      flashStakeUsdFromPosition({
        sizeUsd: 500,
        leverage: 515.463918,
        collateralUsd: 0.97,
      }),
    ).toBe(1);
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
