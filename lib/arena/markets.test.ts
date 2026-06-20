import { describe, expect, it } from "vitest";
import { ASSET_MARKETS, marketForAsset, assetForMarket, activeMarkets } from "./markets";
import { ARENA_ASSETS } from "./llm/schema";

describe("asset/market routing", () => {
  it("maps every arena asset to a unique market id", () => {
    const ids = ARENA_ASSETS.map((a) => ASSET_MARKETS[a].marketId);
    expect(new Set(ids).size).toBe(ARENA_ASSETS.length);
    expect(Math.max(...ids)).toBeLessThanOrEqual(7); // MAX_MARKETS = 8
  });

  it("keeps SOL on market 0 (the existing live market)", () => {
    expect(ASSET_MARKETS.SOL.marketId).toBe(0);
  });

  it("round-trips asset <-> marketId", () => {
    expect(marketForAsset("BTC").marketId).toBe(ASSET_MARKETS.BTC.marketId);
    expect(assetForMarket(ASSET_MARKETS.ETH.marketId)).toBe("ETH");
  });

  it("activeMarkets lists only assets with a real (non-placeholder) feed", () => {
    const ids = activeMarkets().map((m) => m.marketId);
    expect(ids).toContain(0); // SOL is configured
  });
});
