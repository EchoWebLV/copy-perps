import { describe, expect, it } from "vitest";

import {
  flashRequestedLeverageFromPosition,
  flashStakeUsdFromPosition,
  type FlashStakePosition,
} from "./position-value";

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

describe("flashRequestedLeverageFromPosition", () => {
  it("recovers the opened leverage from notional and original stake", () => {
    expect(
      flashRequestedLeverageFromPosition({
        sizeUsd: 500,
        leverage: 1953,
        collateralUsd: 0.35,
        entryCostUsd: 1,
      }),
    ).toBe(500);
  });

  it("prefers cached requested leverage over refreshed reduced notional", () => {
    const position = {
      sizeUsd: 331,
      leverage: 500,
      collateralUsd: 1,
      entryCostUsd: 1,
      pnlUsd: -0.16,
      isProfitable: false,
    };

    expect(flashRequestedLeverageFromPosition(position)).toBe(500);
    expect(flashStakeUsdFromPosition(position)).toBe(1);
  });

  it("maps Flash quote effective leverage back to the configured option", () => {
    expect(
      flashRequestedLeverageFromPosition({
        sizeUsd: 500,
        leverage: 515.463918,
        collateralUsd: 0.97,
      }),
    ).toBe(500);
  });

  it("recovers a 500x open from profitable reduced effective leverage", () => {
    const position = {
      sizeUsd: 500,
      leverage: 328,
      collateralUsd: 1.52,
      pnlUsd: 0.31,
      isProfitable: true,
    };

    expect(flashRequestedLeverageFromPosition(position)).toBe(500);
    expect(flashStakeUsdFromPosition(position)).toBe(1);
  });
});
