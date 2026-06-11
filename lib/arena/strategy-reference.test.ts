import { describe, expect, it } from "vitest";
import cases from "../../fixtures/arena/strategy-cases.json";
import { decideRingMomentum, type StrategyCandle } from "./strategy-reference";

interface FixtureCase {
  name: string;
  params: { breakoutBps: number; activityMultBps: number; trendFilter: boolean };
  candles: Array<{ o: string; h: string; l: string; c: string; pathLen: string }>;
  expected: "long" | "short" | null;
}

describe("ring momentum v1 reference (parity source of truth)", () => {
  for (const fixture of cases as FixtureCase[]) {
    it(fixture.name, () => {
      const candles: StrategyCandle[] = fixture.candles.map((k) => ({
        o: BigInt(k.o),
        h: BigInt(k.h),
        l: BigInt(k.l),
        c: BigInt(k.c),
        pathLen: BigInt(k.pathLen),
      }));
      expect(decideRingMomentum(candles, fixture.params)).toBe(fixture.expected);
    });
  }
});
