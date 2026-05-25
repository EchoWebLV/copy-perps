import { describe, expect, it } from "vitest";
import { PULSE_REACTIONS } from "./pulse-social";

describe("Pulse social helpers", () => {
  it("uses tailing, bullish, and bearish as the primary reaction set", () => {
    expect(PULSE_REACTIONS).toEqual(["Tailing", "Bullish", "Bearish"]);
  });
});
