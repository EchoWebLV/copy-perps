import { describe, expect, it } from "vitest";
import {
  SUPPORTED_FLASH_MARKETS,
  isFlashCopyableMarket,
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
});
