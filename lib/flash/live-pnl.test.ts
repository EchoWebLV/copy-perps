import { describe, expect, it } from "vitest";

import { computeFlashLivePositionView } from "./live-pnl";

describe("computeFlashLivePositionView", () => {
  it("starts a freshly opened Flash position down by the paid open fee", () => {
    const view = computeFlashLivePositionView({
      position: {
        symbol: "SOL",
        side: "long",
        positionPubkey: "pos-fee",
        marketAccount: "market-1",
        entryPriceUsd: 100,
        markPriceUsd: 100,
        sizeUsd: 500,
        collateralUsd: 0.97,
        leverage: 515.463918,
        entryCostUsd: 1,
        openFeeUsd: 0.03,
        pnlUsd: 0,
        receiveUsd: 0.97,
        openTime: 1,
      } as Parameters<typeof computeFlashLivePositionView>[0]["position"] & {
        entryCostUsd: number;
        openFeeUsd: number;
      },
    });

    expect(view.stakeUsd).toBeCloseTo(1);
    expect(view.pnlUsd).toBeCloseTo(-0.03);
    expect(view.valueUsd).toBeCloseTo(0.97);
    expect(view.exitValueUsd).toBeCloseTo(0.97);
    expect(view.roiPct).toBeCloseTo(-3);
  });

  it("keeps a refreshed Flash position down by fees when cached fee fields are missing", () => {
    const view = computeFlashLivePositionView({
      position: {
        symbol: "SOL",
        side: "long",
        positionPubkey: "pos-refreshed-fee",
        marketAccount: "market-1",
        entryPriceUsd: 100,
        markPriceUsd: 100,
        sizeUsd: 500,
        collateralUsd: 0.97,
        leverage: 515.463918,
        pnlUsd: 0,
        receiveUsd: 0.97,
        openTime: 1,
      },
    });

    expect(view.stakeUsd).toBeCloseTo(1);
    expect(view.pnlUsd).toBeCloseTo(-0.03);
    expect(view.valueUsd).toBeCloseTo(0.97);
    expect(view.exitValueUsd).toBeCloseTo(0.97);
    expect(view.roiPct).toBeCloseTo(-3);
  });

  it("keeps Flash fee adjustment while estimating long PnL from a live mark", () => {
    const view = computeFlashLivePositionView({
      position: {
        symbol: "SOL",
        side: "long",
        positionPubkey: "pos-1",
        marketAccount: "market-1",
        entryPriceUsd: 100,
        markPriceUsd: 100,
        sizeUsd: 500,
        collateralUsd: 0.95,
        leverage: 500,
        pnlUsd: -0.05,
        receiveUsd: 0.95,
        openTime: 1,
      },
      liveMarkUsd: 101,
    });

    expect(view.markPriceUsd).toBe(101);
    expect(view.pnlUsd).toBeCloseTo(4.95);
    expect(view.valueUsd).toBeCloseTo(5.95);
    expect(view.exitValueUsd).toBeCloseTo(5.95);
    expect(view.roiPct).toBeCloseTo(495);
    expect(view.isEstimated).toBe(true);
  });

  it("estimates short PnL from a live mark", () => {
    const view = computeFlashLivePositionView({
      position: {
        symbol: "ETH",
        side: "short",
        positionPubkey: "pos-2",
        marketAccount: "market-2",
        entryPriceUsd: 2000,
        markPriceUsd: 2000,
        sizeUsd: 100,
        collateralUsd: 2,
        leverage: 50,
        pnlUsd: -0.02,
        openTime: 1,
      },
      liveMarkUsd: 1980,
    });

    expect(view.pnlUsd).toBeCloseTo(0.98);
    expect(view.valueUsd).toBeCloseTo(2.98);
    expect(view.roiPct).toBeCloseTo(49);
    expect(view.isEstimated).toBe(true);
  });

  it("recovers a profitable refreshed 500x position from live price PnL", () => {
    const view = computeFlashLivePositionView({
      position: {
        symbol: "ETH",
        side: "short",
        positionPubkey: "pos-profitable-refresh",
        marketAccount: "market-2",
        entryPriceUsd: 2000,
        markPriceUsd: 2000,
        sizeUsd: 330,
        collateralUsd: 0.83,
        leverage: 398,
        openTime: 1,
      },
      liveMarkUsd: 1999,
    });

    expect(view.stakeUsd).toBeCloseTo(0.66);
    expect(view.roiPct).toBeGreaterThan(0);
  });

  it("keeps a losing refreshed 500x position on cached requested leverage", () => {
    const view = computeFlashLivePositionView({
      position: {
        symbol: "ETH",
        side: "short",
        positionPubkey: "pos-losing-refresh",
        marketAccount: "market-2",
        entryPriceUsd: 2000,
        markPriceUsd: 2008,
        sizeUsd: 331,
        collateralUsd: 1,
        leverage: 500,
        entryCostUsd: 1,
        pnlUsd: -0.16,
        receiveUsd: 0.84,
        openTime: 1,
      },
    });

    expect(view.stakeUsd).toBeCloseTo(1);
    expect(view.roiPct).toBeCloseTo(-16);
  });

  it("uses exact Flash receive value when no live mark is available", () => {
    const view = computeFlashLivePositionView({
      position: {
        symbol: "BTC",
        side: "long",
        positionPubkey: "pos-3",
        marketAccount: "market-3",
        entryPriceUsd: 100000,
        markPriceUsd: 100000,
        sizeUsd: 1000,
        collateralUsd: 9.5,
        leverage: 100,
        pnlUsd: -0.5,
        receiveUsd: 9.5,
        openTime: 1,
      },
    });

    expect(view.markPriceUsd).toBe(100000);
    expect(view.pnlUsd).toBeCloseTo(-0.5);
    expect(view.valueUsd).toBeCloseTo(9.5);
    expect(view.exitValueUsd).toBeCloseTo(9.5);
    expect(view.roiPct).toBeCloseTo(-5);
    expect(view.isEstimated).toBe(false);
  });
});
