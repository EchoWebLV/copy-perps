// lib/flash-v2/pnl.test.ts
import { describe, expect, it } from "vitest";
import { markPnlUsd } from "./pnl";

describe("markPnlUsd", () => {
  it("computes long PnL net of fees", () => {
    // +10% on $100 size = $10 gross, minus $1 fees = $9
    expect(
      markPnlUsd({ side: "long", entryPrice: 100, markPrice: 110, sizeUsd: 100, feesUsd: 1 }),
    ).toBe(9);
  });
  it("computes short PnL (price up = loss)", () => {
    expect(
      markPnlUsd({ side: "short", entryPrice: 100, markPrice: 110, sizeUsd: 100 }),
    ).toBe(-10);
  });
});
