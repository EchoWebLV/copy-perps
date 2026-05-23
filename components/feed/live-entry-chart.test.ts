import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildLiveEntryChartModel,
  initialLiveEntryChartNowMs,
  type ChartCandle,
} from "./live-entry-chart";
import { LiveEntryChart } from "./LiveEntryChart";

const candles: ChartCandle[] = [
  { ts: 1_000, open: 100, high: 104, low: 99, close: 102, volume: 10 },
  { ts: 2_000, open: 102, high: 108, low: 101, close: 106, volume: 12 },
  { ts: 3_000, open: 106, high: 109, low: 103, close: 104, volume: 14 },
];

describe("buildLiveEntryChartModel", () => {
  it("uses a deterministic initial now value for hydration", () => {
    expect(initialLiveEntryChartNowMs(2_000)).toBe(62_000);
  });

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

  it("uses the latest candle close when a live current mark is not available", () => {
    const model = buildLiveEntryChartModel({
      candles,
      entryMark: 106,
      currentMark: null,
      openSinceMs: 2_000,
    });

    expect(model.current.price).toBe(104);
    expect(model.points.at(-1)?.price).toBe(104);
  });

  it("rounds SVG coordinate attributes for stable hydration", () => {
    const html = renderToStaticMarkup(
      createElement(LiveEntryChart, {
        pos: {
          positionId: "pos-1",
          asset: "ETH",
          side: "long",
          leverage: 10,
          entryMark: 106,
          currentMark: 104,
          openSinceMs: Date.parse("2026-05-23T12:00:00.000Z"),
        },
      }),
    );

    expect(html).not.toMatch(/\b(?:cx|cy|x|y|x1|x2|y1|y2)="[^"]*\.\d{3,}"/);
  });
});
