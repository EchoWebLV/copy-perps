import { describe, expect, it } from "vitest";
import { DEFAULT_FLOOR, ORACLE_BOTS } from "./registry";

describe("oracle-bot registry", () => {
  it("ships the four model bots", () => {
    expect(ORACLE_BOTS.map((b) => b.persona).sort()).toEqual([
      "claude-v1",
      "gpt-v1",
      "grok-v1",
      "vader-v1",
    ]);
  });

  it("the model is the ONLY variable — same prompt + same floor params for all", () => {
    const first = ORACLE_BOTS[0];
    for (const b of ORACLE_BOTS) {
      expect(b.systemBlock).toEqual(first.systemBlock); // identical prompt
      expect(b.params).toEqual(first.params); // identical risk limits
    }
    // ...but the providers/models genuinely differ (that's the experiment).
    expect(new Set(ORACLE_BOTS.map((b) => b.provider)).size).toBeGreaterThan(1);
  });

  it("every persona id fits the 16-byte on-chain seed", () => {
    for (const b of ORACLE_BOTS) {
      expect(Buffer.byteLength(b.persona, "utf8")).toBeLessThanOrEqual(16);
      expect(b.operatorEnv).toMatch(/^ARENA_LLM_OPERATOR_/);
    }
  });

  it("floor params satisfy the on-chain init_llm_bot domain", () => {
    const p = DEFAULT_FLOOR;
    expect(p.maxLeverage).toBeGreaterThanOrEqual(1);
    expect(p.maxStakeFracBps).toBeLessThanOrEqual(10_000);
    expect(p.minStopBps).toBeGreaterThanOrEqual(1);
    expect(p.minStopBps).toBeLessThanOrEqual(p.maxStopBps);
    expect(p.maxStopBps).toBeLessThan(10_000);
    expect(p.dailyLossLimitBps).toBeLessThanOrEqual(10_000);
    expect(p.confidenceFloor).toBeLessThanOrEqual(100);
    expect([0, 1]).toContain(p.riskSizing);
    expect(p.maxHoldTicks).toBeGreaterThanOrEqual(1);
  });
});
