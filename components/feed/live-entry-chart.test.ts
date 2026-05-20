import { describe, expect, it } from "vitest";
import { buildLiveEntryChartModel, type ChartCandle } from "./live-entry-chart";

const candles: ChartCandle[] = [
  { ts: 1_000, open: 100, high: 104, low: 99, close: 102, volume: 10 },
  { ts: 2_000, open: 102, high: 108, low: 101, close: 106, volume: 12 },
  { ts: 3_000, open: 106, high: 109, low: 103, close: 104, volume: 14 },
];

describe("buildLiveEntryChartModel", () => {
  it("places the entry dot at the position open time and entry price", () => {
    const model = buildLiveEntryChartModel({
      candles,
      entryMark: 106,
      currentMark: 104,
      openSinceMs: 2_000,
    });

    expect(model.entry.clamped).toBe(false);
    expect(model.entry.x).toBeGreaterThan(model.plot.left);
    expect(model.entry.x).toBeLessThan(model.plot.right);
    expect(model.entry.y).toBeLessThan(model.current.y);
    expect(model.linePath).toContain("M");
    expect(model.rangeBars).toHaveLength(candles.length);
  });

  it("clamps old entries to the left edge while keeping the entry price in range", () => {
    const model = buildLiveEntryChartModel({
      candles,
      entryMark: 112,
      currentMark: 104,
      openSinceMs: 250,
    });

    expect(model.entry.clamped).toBe(true);
    expect(model.entry.x).toBe(model.plot.left);
    expect(model.entry.y).toBeGreaterThanOrEqual(model.plot.top);
    expect(model.entry.y).toBeLessThan(model.current.y);
  });
});
