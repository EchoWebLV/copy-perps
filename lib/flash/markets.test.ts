import { describe, expect, it } from "vitest";
import {
  FLASH_MARKETS,
  FLASH_POOL_NAMES,
  flashLeverageBoundsForMarket,
  SUPPORTED_FLASH_MARKETS,
  flashPoolNameForMarket,
  flashTradeModeForLeverage,
  isFlashCopyableMarket,
  maxFlashDegenLeverageForMarket,
  maxFlashLeverageForMarket,
  normalizeFlashMarket,
} from "./markets";

describe("Flash copyable markets", () => {
  it("exposes every Flash market that the SDK can open as a perp", () => {
    expect(SUPPORTED_FLASH_MARKETS).toEqual([
      "BTC",
      "ETH",
      "SOL",
      "ZEC",
      "BNB",
      "BONK",
      "PENGU",
      "PUMP",
      "WIF",
      "FARTCOIN",
      "ORE",
      "JUP",
      "PYTH",
      "JTO",
      "KMNO",
      "HYPE",
      "MEGA",
      "XAU",
      "XAG",
      "EUR",
      "GBP",
      "CRUDEOIL",
      "USDJPY",
      "USDCNH",
      "NATGAS",
      "SPY",
      "NVDA",
      "TSLA",
      "AAPL",
      "AMD",
      "AMZN",
    ]);
    expect(isFlashCopyableMarket("BTC")).toBe(true);
    expect(isFlashCopyableMarket("HYPE")).toBe(true);
    expect(isFlashCopyableMarket("bonk")).toBe(true);
    expect(isFlashCopyableMarket("nvda")).toBe(true);
    expect(isFlashCopyableMarket("JitoSOL")).toBe(false);
    expect(isFlashCopyableMarket("XAUt")).toBe(false);
    expect(isFlashCopyableMarket("NEAR")).toBe(false);
  });

  it("normalizes symbols and resolves their Flash pool", () => {
    expect(normalizeFlashMarket(" hype ")).toBe("HYPE");
    expect(normalizeFlashMarket("xau")).toBe("XAU");
    expect(normalizeFlashMarket("jitosol")).toBeNull();
    expect(flashPoolNameForMarket("HYPE")).toBe("Governance.1");
    expect(flashPoolNameForMarket("BONK")).toBe("Community.1");
    expect(flashPoolNameForMarket("WIF")).toBe("Community.2");
    expect(flashPoolNameForMarket("NVDA")).toBe("Equity.1");
    expect(flashPoolNameForMarket("USDJPY")).toBe("Virtual.1");
    expect(FLASH_POOL_NAMES).toEqual([
      "Crypto.1",
      "Community.1",
      "Community.2",
      "Equity.1",
      "Governance.1",
      "Ore.1",
      "Trump.1",
      "Virtual.1",
    ]);
  });

  it("exposes Flash leverage ceilings from executable market accounts", () => {
    expect(maxFlashDegenLeverageForMarket("BTC")).toBe(500);
    expect(maxFlashLeverageForMarket("BONK")).toBe(25);
    expect(maxFlashLeverageForMarket("HYPE")).toBe(20);
    expect(maxFlashLeverageForMarket("ORE")).toBe(5);
    expect(maxFlashLeverageForMarket("USDJPY")).toBe(500);
    expect(maxFlashLeverageForMarket("TSLA")).toBe(20);
    expect(maxFlashLeverageForMarket("NEAR")).toBeNull();
    expect(flashLeverageBoundsForMarket("SOL", "standard")).toEqual({
      min: 1,
      max: 100,
    });
    expect(flashLeverageBoundsForMarket("SOL", "degen")).toEqual({
      min: 125,
      max: 500,
    });
    expect(flashLeverageBoundsForMarket("BONK", "standard")).toEqual({
      min: 1,
      max: 25,
    });
    expect(flashLeverageBoundsForMarket("USDJPY", "standard")).toEqual({
      min: 1,
      max: 100,
    });
    expect(flashLeverageBoundsForMarket("USDJPY", "degen")).toEqual({
      min: 125,
      max: 500,
    });
  });

  it("picks degen mode only when leverage is above the standard ceiling", () => {
    expect(flashTradeModeForLeverage("SOL", 100)).toBe("standard");
    expect(flashTradeModeForLeverage("SOL", 125)).toBe("degen");
    expect(flashTradeModeForLeverage("BONK", 25)).toBe("standard");
    expect(flashTradeModeForLeverage("BONK", 50)).toBeNull();
    expect(flashTradeModeForLeverage("NEAR", 10)).toBeNull();
  });

  it("does not include collateral-only Flash tokens as trade markets", () => {
    const symbols: readonly string[] = FLASH_MARKETS.map((market) => market.symbol);

    expect(symbols).not.toContain("JitoSOL");
    expect(symbols).not.toContain("XAUt");
  });
});
