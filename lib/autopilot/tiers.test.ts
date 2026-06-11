import { describe, expect, it } from "vitest";
import { computeStake, getTier, isTierName, TIERS } from "./tiers";

describe("autopilot tiers", () => {
  it("defines the three locked tiers", () => {
    expect(TIERS.cruise).toMatchObject({
      mode: "standard",
      leverage: 50,
      maxLeverage: 100,
      stakePctOfBudget: 0.1,
      maxConcurrent: 2,
      slRoiPct: -50,
      tpRoiPct: 100,
      maxHoldMin: 90,
    });
    expect(TIERS.sweat).toMatchObject({
      mode: "degen",
      leverage: 150,
      maxLeverage: 250,
      stakePctOfBudget: 0.05,
      maxConcurrent: 1,
      slRoiPct: -50,
      tpRoiPct: 100,
      maxHoldMin: 45,
    });
    expect(TIERS.degen).toMatchObject({
      mode: "degen",
      leverage: 500,
      maxLeverage: 500,
      stakeUsdMin: 1,
      stakeUsdMax: 10,
      maxConcurrent: 1,
      slRoiPct: -50,
      tpRoiPct: 150,
      maxHoldMin: 15,
    });
  });

  it("trigger ROIs sit inside the Flash clamps (SL -95..-1, TP 1..10000)", () => {
    for (const tier of Object.values(TIERS)) {
      expect(tier.slRoiPct).toBeGreaterThanOrEqual(-95);
      expect(tier.slRoiPct).toBeLessThanOrEqual(-1);
      expect(tier.tpRoiPct).toBeGreaterThanOrEqual(1);
      expect(tier.tpRoiPct).toBeLessThanOrEqual(10_000);
    }
  });

  it("isTierName / getTier", () => {
    expect(isTierName("cruise")).toBe(true);
    expect(isTierName("yolo")).toBe(false);
    expect(getTier("sweat").leverage).toBe(150);
  });

  it("computeStake: pct of remaining budget, floored at $1", () => {
    expect(computeStake("cruise", 100)).toBe(10); // 10%
    expect(computeStake("sweat", 100)).toBe(5); // 5%
    expect(computeStake("cruise", 5)).toBe(1); // 0.5 -> $1 floor
  });

  it("computeStake: degen hard-caps at $10", () => {
    expect(computeStake("degen", 200)).toBe(10); // 10% = 20 -> cap 10
    expect(computeStake("degen", 50)).toBe(5);
    expect(computeStake("degen", 5)).toBe(1); // floor
  });

  it("computeStake: never exceeds the remaining budget", () => {
    expect(computeStake("cruise", 1)).toBe(1);
    expect(computeStake("cruise", 0.99)).toBeNull();
    expect(computeStake("cruise", 0)).toBeNull();
    expect(computeStake("cruise", Number.NaN)).toBeNull();
  });

  it("computeStake: respects the Flash $10 min notional at every tier", () => {
    for (const tier of Object.values(TIERS)) {
      const stake = computeStake(tier.name, 100);
      expect(stake).not.toBeNull();
      expect((stake as number) * tier.leverage).toBeGreaterThanOrEqual(10);
    }
  });
});
