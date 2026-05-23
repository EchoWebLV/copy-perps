import { describe, expect, it } from "vitest";
import { buildPnlChartPath } from "./pnl-chart";

describe("buildPnlChartPath", () => {
  it("builds a left-to-right path for whale PnL points", () => {
    const path = buildPnlChartPath(
      [
        { t: 1000, v: 10 },
        { t: 2000, v: -10 },
        { t: 3000, v: 30 },
      ],
      100,
      50,
    );

    expect(path).toBe("M 0.00 25.00 L 50.00 50.00 L 100.00 0.00");
  });
});
