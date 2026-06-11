import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/data/candles";
import { decide, shouldExit } from "./brain";

function flat(count: number, price = 100, volume = 10): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    ts: i * 900_000,
    open: price,
    high: price * 1.002,
    low: price * 0.998,
    close: price,
    volume,
  }));
}

describe("autopilot brain — decide", () => {
  it("fires long on an upside breakout with volume confirm", () => {
    const candles = [
      ...flat(19),
      { ts: 19 * 900_000, open: 100, high: 101.2, low: 100, close: 101, volume: 30 },
    ];
    const decision = decide({ candles, markPrice: 101 });
    expect(decision?.side).toBe("long");
    expect(decision?.conviction).toBeGreaterThanOrEqual(0.3);
    expect(decision?.conviction).toBeLessThanOrEqual(1);
  });

  it("fires short on a downside breakout with volume confirm", () => {
    const candles = [
      ...flat(19),
      { ts: 19 * 900_000, open: 100, high: 100, low: 98.8, close: 99, volume: 30 },
    ];
    const decision = decide({ candles, markPrice: 99 });
    expect(decision?.side).toBe("short");
  });

  it("stays flat when there is no breakout", () => {
    expect(decide({ candles: flat(20), markPrice: 100 })).toBeNull();
  });

  it("vetoes a breakout candle with NaN volume (fail closed)", () => {
    const candles = [
      ...flat(19),
      { ts: 19 * 900_000, open: 100, high: 101.2, low: 100, close: 101, volume: Number.NaN },
    ];
    expect(decide({ candles, markPrice: 101 })).toBeNull();
  });

  it("vetoes a breakout candle with zero close (fail closed)", () => {
    const candles = [
      ...flat(19),
      { ts: 19 * 900_000, open: 100, high: 101.2, low: 100, close: 0, volume: 30 },
    ];
    expect(decide({ candles, markPrice: 101 })).toBeNull();
  });

  it("stays flat when volume does not confirm", () => {
    const candles = [
      ...flat(19),
      { ts: 19 * 900_000, open: 100, high: 101.2, low: 100, close: 101, volume: 12 },
    ];
    expect(decide({ candles, markPrice: 101 })).toBeNull();
  });

  it("stays flat on too few candles or a bad mark", () => {
    expect(decide({ candles: flat(5), markPrice: 100 })).toBeNull();
    expect(decide({ candles: flat(20), markPrice: 0 })).toBeNull();
    expect(decide({ candles: flat(20), markPrice: Number.NaN })).toBeNull();
  });

  it("requires the net window move to agree with the breakout", () => {
    // Synthetic shape (close > high is fine for math, impossible IRL):
    // candle 0 closes at 108 while every prior HIGH stays ~100.2, so the
    // last candle at 101 clears the prior range (a valid "breakout") yet
    // the net window move is DOWN (108 -> 101). The trend filter must veto
    // the long.
    const base = flat(19);
    const candles = [
      { ...base[0], close: 108 },
      ...base.slice(1),
      { ts: 19 * 900_000, open: 100, high: 101.2, low: 100, close: 101, volume: 30 },
    ];
    expect(decide({ candles, markPrice: 101 })).toBeNull();
  });
});

describe("autopilot brain — shouldExit", () => {
  it("banks a 1% favorable move", () => {
    expect(
      shouldExit({ entryPrice: 100, side: "long", markPrice: 101, ageMin: 1, maxHoldMin: 90 }),
    ).toBe(true);
    expect(
      shouldExit({ entryPrice: 100, side: "short", markPrice: 99, ageMin: 1, maxHoldMin: 90 }),
    ).toBe(true);
    expect(
      shouldExit({ entryPrice: 100, side: "long", markPrice: 100.5, ageMin: 1, maxHoldMin: 90 }),
    ).toBe(false);
  });

  it("force-exits at max hold even without a price", () => {
    expect(
      shouldExit({ entryPrice: null, side: "long", markPrice: null, ageMin: 91, maxHoldMin: 90 }),
    ).toBe(true);
    expect(
      shouldExit({ entryPrice: null, side: "long", markPrice: null, ageMin: 10, maxHoldMin: 90 }),
    ).toBe(false);
  });

  it("an adverse move does not exit (the SL trigger owns the downside)", () => {
    expect(
      shouldExit({ entryPrice: 100, side: "long", markPrice: 95, ageMin: 1, maxHoldMin: 90 }),
    ).toBe(false);
  });
});
