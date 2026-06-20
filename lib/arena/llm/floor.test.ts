import { describe, expect, it } from "vitest";
import { evaluateAction, evaluateActions, type LlmBotLiveState, type LlmFloorParams } from "./floor";
import type { LlmAction } from "./schema";

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

function openDecision(over: Partial<LlmAction> = {}): LlmAction {
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

describe("evaluateAction floor", () => {
  it("sends a valid open with converted, clamped args", () => {
    const out = evaluateAction(openDecision(), params, flat, NOW);
    expect(out).toEqual({
      kind: "send",
      args: { action: 1, side: 0, leverage: 10, stakeFracBps: 1_000, stopBps: 200, tpBps: 400, confidence: 80 },
    });
  });

  it("clamps leverage and stake to the caps", () => {
    const out = evaluateAction(openDecision({ leverage: 999, stakeFracPct: 0.5 }), params, flat, NOW);
    expect(out.kind).toBe("send");
    if (out.kind === "send") {
      expect(out.args.leverage).toBe(15);
      expect(out.args.stakeFracBps).toBe(2_000);
    }
  });

  it("clamps leverage UP to the 10x minimum on opens", () => {
    const out = evaluateAction(openDecision({ leverage: 3 }), params, flat, NOW);
    expect(out.kind).toBe("send");
    if (out.kind === "send") expect(out.args.leverage).toBe(10);
  });

  it("encodes side short as 1", () => {
    const out = evaluateAction(openDecision({ side: "short" }), params, flat, NOW);
    if (out.kind === "send") expect(out.args.side).toBe(1);
  });

  it("skips hold without sending", () => {
    expect(evaluateAction(openDecision({ action: "hold" }), params, flat, NOW)).toEqual({
      kind: "skip",
      reason: "Hold",
    });
  });

  it("always allows close (even when halted)", () => {
    const out = evaluateAction(
      openDecision({ action: "close" }),
      params,
      { ...flat, halted: true },
      NOW,
    );
    expect(out.kind).toBe("send");
    if (out.kind === "send") expect(out.args.action).toBe(2);
  });

  it("rejects open when halted", () => {
    expect(evaluateAction(openDecision(), params, { ...flat, halted: true }, NOW)).toEqual({
      kind: "skip",
      reason: "Halted",
    });
  });

  it("rejects open during cooldown", () => {
    const out = evaluateAction(openDecision(), params, { ...flat, lastDecisionTs: 4_990 }, NOW);
    expect(out).toEqual({ kind: "skip", reason: "Cooldown" });
  });

  it("rejects open at the daily trade cap", () => {
    expect(evaluateAction(openDecision(), params, { ...flat, tradesToday: 5 }, NOW)).toEqual({
      kind: "skip",
      reason: "TradeCap",
    });
  });

  it("rejects open below the confidence floor", () => {
    expect(evaluateAction(openDecision({ confidence: 0.5 }), params, flat, NOW)).toEqual({
      kind: "skip",
      reason: "LowConfidence",
    });
  });

  it("rejects open without a stop", () => {
    expect(evaluateAction(openDecision({ stopLossPct: 0 }), params, flat, NOW)).toEqual({
      kind: "skip",
      reason: "StopRequired",
    });
  });

  it("clamps an out-of-band stop instead of rejecting", () => {
    const wide = evaluateAction(openDecision({ stopLossPct: 0.06 }), params, flat, NOW); // 600bps
    expect(wide.kind).toBe("send");
    if (wide.kind === "send") expect(wide.args.stopBps).toBe(500); // clamped to maxStopBps
    const narrow = evaluateAction(openDecision({ stopLossPct: 0.001 }), params, flat, NOW); // 10bps
    expect(narrow.kind).toBe("send");
    if (narrow.kind === "send") expect(narrow.args.stopBps).toBe(50); // clamped to minStopBps
  });
});

describe("evaluateActions", () => {
  const listParams: LlmFloorParams = {
    maxLeverage: 50,
    minStopBps: 50,
    maxStopBps: 300,
    maxStakeFracBps: 2000,
    maxTradesPerDay: 2,
    decisionCooldownSecs: 0,
    confidenceFloor: 40,
  };
  const live: LlmBotLiveState = { halted: false, tradesToday: 0, lastDecisionTs: 0 };
  const open = (asset: LlmAction["asset"]): LlmAction => ({
    action: "open",
    side: "long",
    asset,
    leverage: 10,
    stakeFracPct: 0.1,
    stopLossPct: 0.02,
    takeProfitPct: 0.04,
    confidence: 0.8,
    reasoning: "x",
  });

  it("evaluates each action and tags it with its asset", () => {
    const out = evaluateActions(
      { actions: [open("BTC"), { ...open("SOL"), action: "close" }] },
      listParams,
      live,
      1_000,
    );
    expect(out.map((o) => o.asset)).toEqual(["BTC", "SOL"]);
    expect(out[0].outcome.kind).toBe("send");
    expect(out[1].outcome.kind).toBe("send"); // close always sends
  });

  it("skips opens that would breach the daily trade cap within one tick", () => {
    const out = evaluateActions(
      { actions: [open("BTC"), open("ETH"), open("SOL")] }, // cap is 2
      listParams,
      live,
      1_000,
    );
    expect(out[0].outcome.kind).toBe("send");
    expect(out[1].outcome.kind).toBe("send");
    expect(out[2].outcome).toEqual({ kind: "skip", reason: "TradeCap" });
  });
});
