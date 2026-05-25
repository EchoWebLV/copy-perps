import { describe, expect, it } from "vitest";
import { clampTailLeverage, tailLeverageBounds } from "./tail-leverage";

describe("tail leverage bounds", () => {
  it("defaults the slider to source leverage while capping at market max", () => {
    expect(
      tailLeverageBounds({ sourceLeverage: 7, marketMaxLeverage: 50 }),
    ).toEqual({
      initialLeverage: 7,
      maxLeverage: 50,
    });
  });

  it("falls back to source leverage when market max is missing", () => {
    expect(tailLeverageBounds({ sourceLeverage: 7 })).toEqual({
      initialLeverage: 7,
      maxLeverage: 7,
    });
  });

  it("keeps the initial leverage inside the market max", () => {
    expect(
      tailLeverageBounds({ sourceLeverage: 75, marketMaxLeverage: 50 }),
    ).toEqual({
      initialLeverage: 50,
      maxLeverage: 50,
    });
  });

  it("clamps selected leverage to the same integer range", () => {
    expect(clampTailLeverage(0, 50)).toBe(1);
    expect(clampTailLeverage(9.4, 50)).toBe(9);
    expect(clampTailLeverage(99, 50)).toBe(50);
  });
});
