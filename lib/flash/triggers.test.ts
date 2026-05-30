import { describe, expect, it } from "vitest";

import {
  roiPctFromTriggerPrice,
  roiPctToIntegerPercent,
  validateTriggerRoi,
  TP_MIN_ROI_PCT,
  SL_MIN_ROI_PCT,
} from "./triggers";

describe("validateTriggerRoi", () => {
  it("accepts a take-profit in profit", () => {
    const r = validateTriggerRoi("tp", 100);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.roiPct).toBeCloseTo(100);
  });

  it("rejects a take-profit at or below entry", () => {
    expect(validateTriggerRoi("tp", 0).ok).toBe(false);
    const r = validateTriggerRoi("tp", -10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/profit/i);
  });

  it("clamps a take-profit below the minimum profit floor", () => {
    const r = validateTriggerRoi("tp", 0.4);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.roiPct).toBeCloseTo(TP_MIN_ROI_PCT);
  });

  it("accepts a stop-loss between entry and liquidation", () => {
    const r = validateTriggerRoi("sl", -50);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.roiPct).toBeCloseTo(-50);
  });

  it("rejects a stop-loss at or above entry", () => {
    expect(validateTriggerRoi("sl", 0).ok).toBe(false);
    const r = validateTriggerRoi("sl", 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/below entry|entry/i);
  });

  it("rejects a stop-loss at or below liquidation", () => {
    const r = validateTriggerRoi("sl", -100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/liquidat/i);
  });

  it("clamps a stop-loss that hugs liquidation up to the safe floor", () => {
    const r = validateTriggerRoi("sl", -99.9);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.roiPct).toBeCloseTo(SL_MIN_ROI_PCT);
  });

  it("rejects non-finite ROI", () => {
    expect(validateTriggerRoi("tp", Number.NaN).ok).toBe(false);
  });
});

describe("roiPctToIntegerPercent", () => {
  it("rounds to the integer percent getTriggerPriceFromRoiSync expects", () => {
    expect(roiPctToIntegerPercent(100)).toBe(100);
    expect(roiPctToIntegerPercent(-50.4)).toBe(-50);
    expect(roiPctToIntegerPercent(33.7)).toBe(34);
  });
});

describe("roiPctFromTriggerPrice", () => {
  it("derives ROI on collateral for a long from the trigger price", () => {
    // 1% up move at 100x leverage (size/collateral = 100) ≈ +100% on collateral.
    const roi = roiPctFromTriggerPrice({
      entryPriceUsd: 100,
      triggerPriceUsd: 101,
      sizeUsd: 100,
      collateralUsd: 1,
      side: "long",
    });
    expect(roi).toBeCloseTo(100, 0);
  });

  it("derives a negative ROI for a long stop below entry", () => {
    const roi = roiPctFromTriggerPrice({
      entryPriceUsd: 100,
      triggerPriceUsd: 99.5,
      sizeUsd: 100,
      collateralUsd: 1,
      side: "long",
    });
    expect(roi).toBeCloseTo(-50, 0);
  });

  it("inverts the sign for a short", () => {
    const roi = roiPctFromTriggerPrice({
      entryPriceUsd: 2000,
      triggerPriceUsd: 1980, // price down → short profits
      sizeUsd: 100,
      collateralUsd: 2,
      side: "short",
    });
    expect(roi).toBeCloseTo(50, 0); // (2000-1980)/2000 * (100/2) * 100 = 50
  });

  it("returns 0 when inputs are degenerate", () => {
    expect(
      roiPctFromTriggerPrice({
        entryPriceUsd: 0,
        triggerPriceUsd: 101,
        sizeUsd: 100,
        collateralUsd: 1,
        side: "long",
      }),
    ).toBe(0);
  });

  it("returns 0 for a non-finite or non-positive trigger price", () => {
    expect(
      roiPctFromTriggerPrice({
        entryPriceUsd: 100,
        triggerPriceUsd: Number.NaN,
        sizeUsd: 100,
        collateralUsd: 1,
        side: "long",
      }),
    ).toBe(0);
    expect(
      roiPctFromTriggerPrice({
        entryPriceUsd: 100,
        triggerPriceUsd: 0,
        sizeUsd: 100,
        collateralUsd: 1,
        side: "long",
      }),
    ).toBe(0);
  });
});
