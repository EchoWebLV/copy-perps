import { describe, expect, it } from "vitest";
import { getPulseReactionTone, PULSE_REACTIONS } from "./pulse-social";

describe("Pulse social helpers", () => {
  it("uses tailing, bullish, and bearish as the primary reaction set", () => {
    expect(PULSE_REACTIONS).toEqual(["Tailing", "Bullish", "Bearish"]);
  });

  it("maps bullish and bearish reactions to trading colors", () => {
    expect(getPulseReactionTone("Tailing")).toBe("accent");
    expect(getPulseReactionTone("Bullish")).toBe("green");
    expect(getPulseReactionTone("Bearish")).toBe("red");
  });
});
