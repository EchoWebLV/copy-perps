import { describe, expect, it } from "vitest";
import { formatWhalePositionAge } from "./whale-position-age";

describe("formatWhalePositionAge", () => {
  it("does not label fresh positions as just now", () => {
    expect(formatWhalePositionAge(59_000, 60_000)).toBe("<1M AGO");
  });

  it("formats older whale opens without collapsing them to now", () => {
    expect(formatWhalePositionAge(0, 90 * 60_000)).toBe("1H AGO");
    expect(formatWhalePositionAge(0, 49 * 60 * 60_000)).toBe("2D AGO");
  });
});
