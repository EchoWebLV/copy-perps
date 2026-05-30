import { describe, expect, it } from "vitest";

import { buildChannel, valueAtRoi, LIQ_ROI_PCT } from "./graph-channel";

describe("valueAtRoi", () => {
  it("maps ROI to position value in money-space", () => {
    expect(valueAtRoi(1, 0)).toBeCloseTo(1); // entry
    expect(valueAtRoi(1, 100)).toBeCloseTo(2); // +100% TP
    expect(valueAtRoi(1, -50)).toBeCloseTo(0.5); // -50% SL
    expect(valueAtRoi(1, LIQ_ROI_PCT)).toBeCloseTo(0); // liquidation
    expect(valueAtRoi(20, 25)).toBeCloseTo(25);
  });
});

describe("buildChannel", () => {
  it("default position draws only entry + liq lines (TP/SL opt-in)", () => {
    const ch = buildChannel({ stakeUsd: 1, valueUsd: 1.2 });
    const ids = ch.lines.map((l) => l.id).sort();
    expect(ids).toEqual(["entry", "liq"]);
    expect(ch.lines.find((l) => l.id === "entry")!.valueUsd).toBeCloseTo(1);
    expect(ch.lines.find((l) => l.id === "liq")!.valueUsd).toBeCloseTo(0);
    expect(ch.minValue).toBeCloseTo(0); // liq floor anchors the bottom
    expect(ch.maxValue).toBeGreaterThan(1.2); // headroom above the live tip
  });

  it("adds TP and SL lines once configured", () => {
    const ch = buildChannel({
      stakeUsd: 1,
      valueUsd: 1.8,
      tp: { kind: "tp", roiPct: 100 },
      sl: { kind: "sl", roiPct: -50 },
    });
    expect(ch.lines.map((l) => l.id).sort()).toEqual([
      "entry",
      "liq",
      "sl",
      "tp",
    ]);
    expect(ch.lines.find((l) => l.id === "tp")!.valueUsd).toBeCloseTo(2);
    expect(ch.lines.find((l) => l.id === "sl")!.valueUsd).toBeCloseTo(0.5);
    expect(ch.maxValue).toBeGreaterThan(2); // TP ceiling not clipped at top
  });

  it("valueToY is monotonic: higher value maps to a smaller y (higher on screen)", () => {
    const ch = buildChannel({ stakeUsd: 1, valueUsd: 1 });
    const yTop = ch.valueToY(ch.maxValue, 170, 18);
    const yBottom = ch.valueToY(0, 170, 18);
    const yMid = ch.valueToY(1, 170, 18);
    expect(yTop).toBeCloseTo(18); // top pad
    expect(yBottom).toBeCloseTo(170 - 18); // bottom pad
    expect(yMid).toBeGreaterThan(yTop);
    expect(yMid).toBeLessThan(yBottom);
  });

  it("never clips a value that runs past the TP ceiling", () => {
    const ch = buildChannel({
      stakeUsd: 1,
      valueUsd: 2.4, // already above the +100% TP
      tp: { kind: "tp", roiPct: 100 },
    });
    expect(ch.maxValue).toBeGreaterThanOrEqual(2.4);
    const y = ch.valueToY(2.4, 170, 18);
    expect(y).toBeGreaterThanOrEqual(18); // inside the padded plot area
  });

  it("clamps out-of-domain values into the plot area", () => {
    const ch = buildChannel({ stakeUsd: 1, valueUsd: 1 });
    expect(ch.valueToY(-5, 170, 18)).toBeCloseTo(170 - 18); // below liq clamps to floor
    expect(ch.valueToY(9999, 170, 18)).toBeCloseTo(18); // above ceiling clamps to top
  });

  it("degrades gracefully for a zero stake", () => {
    const ch = buildChannel({ stakeUsd: 0, valueUsd: 0 });
    expect(ch.minValue).toBeCloseTo(0);
    expect(ch.maxValue).toBeGreaterThan(0);
    expect(Number.isFinite(ch.valueToY(0, 170, 18))).toBe(true);
  });
});
