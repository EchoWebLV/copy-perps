import { describe, expect, it } from "vitest";
import {
  flashV2PositionKey,
  venuePositionToFlashShape,
} from "./self-position";
import type { VenuePosition } from "./types";

function venuePos(over: Partial<VenuePosition> = {}): VenuePosition {
  return {
    positionKey: "vkey-1",
    symbol: "SOL",
    side: "long",
    sizeUsd: 100,
    collateralUsd: 20,
    entryPrice: 100,
    markPrice: 110,
    liquidationPrice: 80,
    leverage: 5,
    ...over,
  };
}

describe("flashV2PositionKey", () => {
  it("is deterministic per (symbol, side) so optimistic + polled positions reconcile", () => {
    expect(flashV2PositionKey("SOL", "long")).toBe("flashv2:SOL:long");
    expect(flashV2PositionKey("BTC", "short")).toBe("flashv2:BTC:short");
  });
});

describe("venuePositionToFlashShape", () => {
  it("maps a populated venue position to the strip shape with mark PnL", () => {
    const out = venuePositionToFlashShape(venuePos());
    expect(out).toMatchObject({
      symbol: "SOL",
      side: "long",
      positionPubkey: "flashv2:SOL:long",
      marketAccount: "vkey-1",
      entryPriceUsd: 100,
      markPriceUsd: 110,
      sizeUsd: 100,
      collateralUsd: 20,
      collateralSymbol: "USDC",
      leverage: 5,
      liquidationPriceUsd: 80,
    });
    // long +10% of $100 size = +$10.
    expect(out.pnlUsd).toBeCloseTo(10);
    expect(out.isProfitable).toBe(true);
    // openTime is omitted (not 0) so the entry-cost merge isn't rejected.
    expect("openTime" in out).toBe(false);
  });

  it("reports a losing short as not profitable", () => {
    const out = venuePositionToFlashShape(
      venuePos({ side: "short", entryPrice: 100, markPrice: 110 }),
    );
    // short with mark above entry loses: -$10.
    expect(out.pnlUsd).toBeCloseTo(-10);
    expect(out.isProfitable).toBe(false);
  });

  it("leaves price-derived fields undefined when the indexer has not populated prices", () => {
    const out = venuePositionToFlashShape(
      venuePos({ entryPrice: 0, markPrice: 0, liquidationPrice: 0, leverage: 0 }),
    );
    expect(out.markPriceUsd).toBeUndefined();
    expect(out.liquidationPriceUsd).toBeUndefined();
    expect(out.leverage).toBeUndefined();
    expect(out.pnlUsd).toBeUndefined();
    expect(out.isProfitable).toBeUndefined();
  });

  it("deducts venue-provided fees + borrow from PnL when present", () => {
    const out = venuePositionToFlashShape(
      venuePos({ feesUsd: 2, borrowUsd: 1 }),
    );
    // +$10 gross - $2 - $1 = $7.
    expect(out.pnlUsd).toBeCloseTo(7);
  });
});
