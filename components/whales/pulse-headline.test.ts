import { describe, expect, it } from "vitest";
import {
  getPulseHeadlineBrushVariant,
  splitPulseHeadline,
} from "./pulse-headline";

describe("splitPulseHeadline", () => {
  it("marks up as green without changing the headline text", () => {
    const parts = splitPulseHeadline("ETH short is already up 162.6%");

    expect(parts.map((part) => part.text).join("")).toBe(
      "ETH short is already up 162.6%",
    );
    expect(parts).toContainEqual({ text: "up", tone: "green" });
  });

  it("marks down as red without changing the headline text", () => {
    const parts = splitPulseHeadline("SOL long is already down 18.0%");

    expect(parts.map((part) => part.text).join("")).toBe(
      "SOL long is already down 18.0%",
    );
    expect(parts).toContainEqual({ text: "down", tone: "red" });
  });

  it("marks the performance percentage for emphasis", () => {
    const parts = splitPulseHeadline("BTC short is already down 46.3%");

    expect(parts.map((part) => part.text).join("")).toBe(
      "BTC short is already down 46.3%",
    );
    expect(parts).toContainEqual({ text: "46.3%", role: "percentage" });
  });

  it("selects stable brush variants across performance headlines", () => {
    const headline = "BTC short is already down 46.3%";

    expect(getPulseHeadlineBrushVariant(headline)).toBe(
      getPulseHeadlineBrushVariant(headline),
    );
    expect(
      new Set([
        getPulseHeadlineBrushVariant(headline),
        getPulseHeadlineBrushVariant("ETH short is already up 162.6%"),
        getPulseHeadlineBrushVariant("SOL long is already down 18.0%"),
      ]).size,
    ).toBeGreaterThan(1);
  });

  it("leaves non-performance headlines as plain text", () => {
    expect(splitPulseHeadline("Late entry risk on BTC long")).toEqual([
      { text: "Late entry risk on BTC long" },
    ]);
  });
});
