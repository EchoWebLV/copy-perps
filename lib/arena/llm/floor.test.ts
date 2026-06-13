import { describe, expect, it } from "vitest";
import { evaluateDecision, type LlmBotLiveState, type LlmFloorParams } from "./floor";
import type { LlmDecision } from "./schema";

// Mirrors paper_llm.rs precheck test params/cases (parity by shared cases).
const params: LlmFloorParams = {
  maxLeverage: 15,
  minStopBps: 50,
  maxStopBps: 500,
  maxStakeFracBps: 2_000,
  maxTradesPerDay: 5,
  decisionCooldownSecs: 60,
  confidenceFloor: 55,
};

const flat: LlmBotLiveState = { halted: false, tradesToday: 0, lastDecisionTs: 0 };
const NOW = 5_000;

function openDecision(over: Partial<LlmDecision> = {}): LlmDecision {
  return {
    action: "open",
    side: "long",
    asset: "SOL",
    leverage: 10,
    stakeFracPct: 0.1,
    stopLossPct: 0.02,
    takeProfitPct: 0.04,
    confidence: 0.8,
    reasoning: "x",
    ...over,
  };
}

describe("evaluateDecision floor", () => {
  it("sends a valid open with converted, clamped args", () => {
    const out = evaluateDecision(openDecision(), params, flat, NOW);
    expect(out).toEqual({
      kind: "send",
      args: { action: 1, side: 0, leverage: 10, stakeFracBps: 1_000, stopBps: 200, tpBps: 400, confidence: 80 },
    });
  });

  it("clamps leverage and stake to the caps", () => {
    const out = evaluateDecision(openDecision({ leverage: 999, stakeFracPct: 0.5 }), params, flat, NOW);
    expect(out.kind).toBe("send");
    if (out.kind === "send") {
      expect(out.args.leverage).toBe(15);
      expect(out.args.stakeFracBps).toBe(2_000);
    }
  });

  it("encodes side short as 1", () => {
    const out = evaluateDecision(openDecision({ side: "short" }), params, flat, NOW);
    if (out.kind === "send") expect(out.args.side).toBe(1);
  });

  it("skips hold without sending", () => {
    expect(evaluateDecision(openDecision({ action: "hold" }), params, flat, NOW)).toEqual({
      kind: "skip",
      reason: "Hold",
    });
  });

  it("always allows close (even when halted)", () => {
    const out = evaluateDecision(
      openDecision({ action: "close" }),
      params,
      { ...flat, halted: true },
      NOW,
    );
    expect(out.kind).toBe("send");
    if (out.kind === "send") expect(out.args.action).toBe(2);
  });

  it("rejects open when halted", () => {
    expect(evaluateDecision(openDecision(), params, { ...flat, halted: true }, NOW)).toEqual({
      kind: "skip",
      reason: "Halted",
    });
  });

  it("rejects open during cooldown", () => {
    const out = evaluateDecision(openDecision(), params, { ...flat, lastDecisionTs: 4_990 }, NOW);
    expect(out).toEqual({ kind: "skip", reason: "Cooldown" });
  });

  it("rejects open at the daily trade cap", () => {
    expect(evaluateDecision(openDecision(), params, { ...flat, tradesToday: 5 }, NOW)).toEqual({
      kind: "skip",
      reason: "TradeCap",
    });
  });

  it("rejects open below the confidence floor", () => {
    expect(evaluateDecision(openDecision({ confidence: 0.5 }), params, flat, NOW)).toEqual({
      kind: "skip",
      reason: "LowConfidence",
    });
  });

  it("rejects open without a stop", () => {
    expect(evaluateDecision(openDecision({ stopLossPct: 0 }), params, flat, NOW)).toEqual({
      kind: "skip",
      reason: "StopRequired",
    });
  });

  it("rejects a stop outside the allowed range", () => {
    expect(evaluateDecision(openDecision({ stopLossPct: 0.001 }), params, flat, NOW).kind).toBe("skip");
    expect(evaluateDecision(openDecision({ stopLossPct: 0.06 }), params, flat, NOW)).toEqual({
      kind: "skip",
      reason: "StopOutOfRange",
    });
  });
});
