import { describe, expect, it } from "vitest";
import { parseFlashV2Price } from "./v2-prices";

describe("parseFlashV2Price", () => {
  it("reads the live XAU shape — priceUi preferred over raw mantissa", () => {
    // verbatim live body 2026-06-12
    const live = {
      price: 4219330,
      exponent: -3,
      confidence: 175,
      priceUi: 4219.33,
      timestampUs: 1781285223600000,
      marketSession: "regular",
    };
    expect(parseFlashV2Price(live)).toBe(4219.33);
  });

  it("falls back to price×10^exponent — never the bare mantissa", () => {
    expect(parseFlashV2Price({ price: 4219330, exponent: -3 })).toBeCloseTo(
      4219.33,
    );
    expect(parseFlashV2Price({ price: 4219330 })).toBeNull(); // no exponent → refuse
    expect(parseFlashV2Price({ priceUi: "3342.55" })).toBe(3342.55);
  });

  it("rejects err-in-200 bodies, junk, and non-positive prices", () => {
    expect(parseFlashV2Price({ err: "Symbol not configured" })).toBeNull();
    expect(parseFlashV2Price({ priceUi: "not-a-number" })).toBeNull();
    expect(parseFlashV2Price({ priceUi: "0" })).toBeNull();
    expect(parseFlashV2Price(null)).toBeNull();
    expect(parseFlashV2Price("3342")).toBeNull();
  });
});
