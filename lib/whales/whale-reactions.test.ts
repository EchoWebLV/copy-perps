import { describe, expect, it } from "vitest";
import { normalizeWhaleReaction } from "./whale-reactions";

describe("normalizeWhaleReaction", () => {
  it("accepts Bullish and Bearish", () => {
    expect(normalizeWhaleReaction("Bullish")).toBe("Bullish");
    expect(normalizeWhaleReaction("Bearish")).toBe("Bearish");
  });

  it("rejects anything else (incl. Tailing) → null", () => {
    expect(normalizeWhaleReaction("Tailing")).toBeNull();
    expect(normalizeWhaleReaction("bullish")).toBeNull();
    expect(normalizeWhaleReaction("")).toBeNull();
    expect(normalizeWhaleReaction(null)).toBeNull();
    expect(normalizeWhaleReaction(undefined)).toBeNull();
    expect(normalizeWhaleReaction(42)).toBeNull();
  });
});
