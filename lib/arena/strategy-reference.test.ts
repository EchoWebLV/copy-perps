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

  it("non-malformed fixtures contain physically possible candles", () => {
    // pathLen = sum of |price deltas| folded into the bucket, so it is bounded
    // below by the range traversal (h - l) and the open-to-close move |c - o|.
    // Cases prefixed "malformed:" deliberately violate candle invariants to pin
    // fail-closed branches and are exempt.
    for (const fixture of cases as FixtureCase[]) {
      if (fixture.name.startsWith("malformed:")) continue;
      for (const k of fixture.candles) {
        const span = BigInt(k.h) - BigInt(k.l);
        const move = BigInt(k.c) - BigInt(k.o);
        const abs = (v: bigint) => (v < 0n ? -v : v);
        const lowerBound = span > abs(move) ? span : abs(move);
        expect(BigInt(k.pathLen) >= lowerBound).toBe(true);
      }
    }
  });

  it("fails closed outside the breakoutBps domain", async () => {
    const { decideRingMomentum: decide } = await import("./strategy-reference");
    const good = (cases as FixtureCase[])[0];
    const candles: StrategyCandle[] = good.candles.map((k) => ({
      o: BigInt(k.o),
      h: BigInt(k.h),
      l: BigInt(k.l),
      c: BigInt(k.c),
      pathLen: BigInt(k.pathLen),
    }));
    expect(decide(candles, { ...good.params, breakoutBps: 10_000 })).toBe(null);
    expect(decide(candles, { ...good.params, breakoutBps: -1 })).toBe(null);
  });
});
