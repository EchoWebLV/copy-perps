import { describe, expect, it } from "vitest";
import {
  flashLeverageBoundsForMarket,
  SUPPORTED_FLASH_MARKETS,
  isFlashCopyableMarket,
  maxFlashDegenLeverageForMarket,
  maxFlashLeverageForMarket,
} from "./markets";

describe("Flash copyable markets", () => {
  it("only exposes markets that the current Flash integration can copy", () => {
    expect(SUPPORTED_FLASH_MARKETS).toEqual(["BTC", "ETH", "SOL"]);
    expect(isFlashCopyableMarket("BTC")).toBe(true);
    expect(isFlashCopyableMarket("ETH")).toBe(true);
    expect(isFlashCopyableMarket("SOL")).toBe(true);
    expect(isFlashCopyableMarket("HYPE")).toBe(false);
    expect(isFlashCopyableMarket("NEAR")).toBe(false);
  });

  it("exposes the Flash leverage ceiling for supported copy markets", () => {
    expect(maxFlashLeverageForMarket("BTC")).toBe(100);
    expect(maxFlashLeverageForMarket("ETH")).toBe(100);
    expect(maxFlashLeverageForMarket(" sol ")).toBe(100);
    expect(maxFlashLeverageForMarket("HYPE")).toBeNull();
  });

  it("exposes separate Flash Degen leverage bounds for manual scalp trades", () => {
    expect(maxFlashDegenLeverageForMarket("BTC")).toBe(500);
    expect(maxFlashDegenLeverageForMarket("ETH")).toBe(500);
    expect(maxFlashDegenLeverageForMarket(" sol ")).toBe(500);
    expect(maxFlashDegenLeverageForMarket("HYPE")).toBeNull();
    expect(flashLeverageBoundsForMarket("SOL", "standard")).toEqual({
      min: 1,
      max: 100,
    });
    expect(flashLeverageBoundsForMarket("SOL", "degen")).toEqual({
      min: 125,
      max: 500,
    });
  });
});
