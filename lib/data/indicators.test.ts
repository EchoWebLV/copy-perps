import { describe, expect, it } from "vitest";
import { atr, ema, macd, realizedVol, rsi } from "./indicators";
import type { Candle } from "./candles";

const candle = (o: number, h: number, l: number, c: number): Candle => ({
  ts: 0,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 0,
});

describe("ema", () => {
  it("returns the constant for a flat series", () => {
    expect(ema([10, 10, 10, 10], 2)).toBe(10);
  });
  it("returns null without enough data", () => {
    expect(ema([1, 2], 5)).toBeNull();
  });
  it("trends toward recent values on a rising series", () => {
    const e = ema([1, 2, 3, 4, 5, 6], 3)!;
    expect(e).toBeGreaterThan(3);
    expect(e).toBeLessThan(6);
  });
});

describe("rsi", () => {
  it("is 100 for a strictly rising series", () => {
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(rising, 14)).toBe(100);
  });
  it("is 0 for a strictly falling series", () => {
    const falling = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(rsi(falling, 14)).toBe(0);
  });
  it("returns null without enough data", () => {
    expect(rsi([1, 2, 3], 14)).toBeNull();
  });
});

describe("macd", () => {
  it("is ~zero for a flat series", () => {
    const flat = Array.from({ length: 40 }, () => 100);
    const m = macd(flat)!;
    expect(m.macd).toBeCloseTo(0, 6);
    expect(m.hist).toBeCloseTo(0, 6);
  });
});

describe("atr", () => {
  it("equals the constant range for steady candles", () => {
    const cs = Array.from({ length: 20 }, () => candle(100, 102, 98, 100)); // range 4, no gaps
    expect(atr(cs, 14)).toBeCloseTo(4, 6);
  });
});

describe("realizedVol", () => {
  it("is 0 for constant closes", () => {
    expect(realizedVol([100, 100, 100, 100])).toBeCloseTo(0, 9);
  });
  it("is positive for a choppy series", () => {
    expect(realizedVol([100, 110, 100, 110, 100])!).toBeGreaterThan(0);
  });
});
