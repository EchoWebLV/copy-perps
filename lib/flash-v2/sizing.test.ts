// lib/flash-v2/sizing.test.ts
import { describe, expect, it } from "vitest";
import { effectiveSizeUsd, effectiveLeverage, meetsTriggerMinimum } from "./sizing";

describe("flash-v2 sizing", () => {
  it("reshapes size by the entry spread (GOTCHAS example: $5 x25 @10% -> ~112.5)", () => {
    expect(effectiveSizeUsd(5, 25, 0.1)).toBeCloseTo(112.5, 4);
  });
  it("computes effective leverage from size/collateral", () => {
    expect(effectiveLeverage(112.5, 5)).toBeCloseTo(22.5, 4);
  });
  it("enforces the $11 minimum collateral for triggers", () => {
    expect(meetsTriggerMinimum(11)).toBe(true);
    expect(meetsTriggerMinimum(10)).toBe(false);
  });
});
