import { describe, expect, it } from "vitest";
import {
  formatWhalePositionAge,
  formatWhalePositionTime,
} from "./whale-position-age";

describe("formatWhalePositionAge", () => {
  it("does not label fresh positions as just now", () => {
    expect(formatWhalePositionAge(59_000, 60_000)).toBe("<1M");
  });

  it("formats hold duration with useful day and hour precision", () => {
    expect(formatWhalePositionAge(0, 90 * 60_000)).toBe("1H 30M");
    expect(formatWhalePositionAge(0, 49 * 60 * 60_000)).toBe("2D 1H");
  });

  it("renders a neutral loading value before the client clock is available", () => {
    expect(formatWhalePositionAge(1_000, 0)).toBe("...");
  });

  it("labels unknown Hyperliquid open times as last seen instead of holding", () => {
    expect(
      formatWhalePositionTime(
        {
          openedAtKnown: false,
          openedAtMs: 59_000,
          lastSeenAtMs: 59_000,
        },
        60_000,
      ),
    ).toEqual({ label: "Seen", value: "<1M" });
  });

  it("measures the Seen value from first-observed time, not the last poll", () => {
    // lastSeenAt resets to now every refresh tick, so it always reads as
    // snapshot staleness (seconds). The honest "Seen" duration is how long the
    // position has been on our tape, which is the sticky first-observed
    // openedAt — it grows over time instead of freezing at "<1M".
    const now = 10 * 24 * 60 * 60_000;
    expect(
      formatWhalePositionTime(
        {
          openedAtKnown: false,
          openedAtMs: now - 3 * 24 * 60 * 60_000, // first spotted 3 days ago
          lastSeenAtMs: now - 30_000, // last polled 30s ago
        },
        now,
      ),
    ).toEqual({ label: "Seen", value: "3D" });
  });
});
