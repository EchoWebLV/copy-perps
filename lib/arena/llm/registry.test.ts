import { describe, expect, it } from "vitest";
import { DEFAULT_FLOOR, GROK_AGGRO_FLOOR, ORACLE_BOTS } from "./registry";

const bot = (persona: string) => ORACLE_BOTS.find((b) => b.persona === persona)!;

describe("oracle-bot registry", () => {
  it("ships the three model bots", () => {
    expect(ORACLE_BOTS.map((b) => b.persona).sort()).toEqual([
      "claude-v1",
      "gpt-v1",
      "grok-v1",
    ]);
  });

  it("gpt-v1 is the patient GPT-5 (DEFAULT_FLOOR baseline)", () => {
    const gpt = bot("gpt-v1");
    expect(gpt.provider).toBe("openai");
    expect(gpt.modelId).toBe("gpt-5");
    expect(gpt.params).toEqual(DEFAULT_FLOOR);
    expect(gpt.closingInstruction).toBeUndefined(); // patient baseline closer
  });

  it("claude-v1 is the repurposed slot: a 2nd, aggressive GPT-5 keeping the Opus label", () => {
    const claude = bot("claude-v1");
    const gpt = bot("gpt-v1");
    expect(claude.provider).toBe("openai"); // GPT brain now (was anthropic)
    expect(claude.modelId).toBe("gpt-5");
    expect(claude.displayName).toBe("Opus 4.8"); // label intentionally kept
    expect(claude.avatarEmoji).toBe("🧠");
    expect(claude.params).toEqual(GROK_AGGRO_FLOOR); // aggressive on-chain floor
    expect(claude.closingInstruction).toBeTruthy(); // hyper-active closer
    expect(claude.params).not.toEqual(gpt.params); // different settings from gpt-v1
  });

  it("grok-v1 is the deliberate hyper-active exception", () => {
    const grok = bot("grok-v1");
    const gpt = bot("gpt-v1"); // contrast against the patient baseline
    expect(grok.systemBlock).not.toEqual(gpt.systemBlock); // aggressive prompt
    expect(grok.closingInstruction).toBeTruthy(); // hyper-active closer override
    // trade cap lifted, position size clamped smaller than the patient baseline.
    expect(grok.params.maxTradesPerDay).toBeGreaterThan(gpt.params.maxTradesPerDay);
    expect(grok.params.maxStakeFracBps).toBeLessThan(gpt.params.maxStakeFracBps);
    expect(grok.params).toEqual(GROK_AGGRO_FLOOR);
  });

  it("every persona id fits the 16-byte on-chain seed", () => {
    for (const b of ORACLE_BOTS) {
      expect(Buffer.byteLength(b.persona, "utf8")).toBeLessThanOrEqual(16);
      expect(b.operatorEnv).toMatch(/^ARENA_LLM_OPERATOR_/);
    }
  });

  it("every floor (controlled + grok) satisfies the on-chain init_llm_bot domain", () => {
    for (const p of [DEFAULT_FLOOR, GROK_AGGRO_FLOOR]) {
      expect(p.maxLeverage).toBeGreaterThanOrEqual(1);
      expect(p.maxStakeFracBps).toBeGreaterThanOrEqual(1);
      expect(p.maxStakeFracBps).toBeLessThanOrEqual(10_000);
      expect(p.maxTradesPerDay).toBeGreaterThanOrEqual(1);
      expect(p.minStopBps).toBeGreaterThanOrEqual(1);
      expect(p.minStopBps).toBeLessThanOrEqual(p.maxStopBps);
      expect(p.maxStopBps).toBeLessThan(10_000);
      expect(p.dailyLossLimitBps).toBeLessThanOrEqual(10_000);
      expect(p.confidenceFloor).toBeLessThanOrEqual(100);
      expect([0, 1]).toContain(p.riskSizing);
      expect(p.maxHoldTicks).toBeGreaterThanOrEqual(1);
    }
  });
});
