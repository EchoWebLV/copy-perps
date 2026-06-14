import { describe, expect, it } from "vitest";
import { DEFAULT_FLOOR, getOracleBot, ORACLE_BOTS } from "./registry";

describe("oracle-bot registry", () => {
  it("ships claude-v1 and grok-v1", () => {
    expect(ORACLE_BOTS.map((b) => b.persona).sort()).toEqual(["claude-v1", "grok-v1"]);
  });

  it("the two bots differ ONLY by provider/model/voice (same floor params)", () => {
    const [claude, grok] = ["claude-v1", "grok-v1"].map((p) => getOracleBot(p)!);
    expect(claude.provider).toBe("anthropic");
    expect(grok.provider).toBe("xai");
    expect(claude.params).toEqual(grok.params); // model is the only variable
    expect(claude.systemBlock).not.toEqual(grok.systemBlock);
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
