import { afterEach, describe, expect, it, vi } from "vitest";
import { DISABLE_ENV, runBotDecision, startLlmBrain, type LlmLoopDeps } from "./loop";
import type { ArenaLlmBot } from "../decode";
import type { LlmDecision } from "./schema";

function fakeBot(over: Partial<ArenaLlmBot> = {}): ArenaLlmBot {
  return {
    balanceUsd: 1000,
    grossPnlUsd: 0,
    feesUsd: 0,
    fundingPaidUsd: 0,
    equityHighUsd: 1000,
    dayStartEquityUsd: 1000,
    seq: 0,
    dayStartTsMs: 0,
    lastDecisionTsMs: 0,
    positions: [],
    tape: [],
    params: {
      maxHoldTicks: 2000,
      decisionCooldownSecs: 60,
      maxLeverage: 15,
      minStopBps: 50,
      maxStopBps: 500,
      maxStakeFracBps: 2000,
      maxTradesPerDay: 5,
      dailyLossLimitBps: 1500,
      fundingBpsPerHour: 2,
      confidenceFloor: 55,
      riskSizing: false,
    },
    personaName: "claude-v1",
    trades: 0,
    wins: 0,
    tradesToday: 0,
    halted: false,
    tapeHead: 0,
    bump: 0,
    ...over,
  };
}

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
    reasoning: "clean reclaim of $150",
    ...over,
  };
}

function deps(over: Partial<LlmLoopDeps> = {}): LlmLoopDeps {
  return {
    now: () => 1_000_000,
    getBotState: vi.fn(async () => fakeBot()),
    buildBrief: vi.fn(async () => "BRIEF"),
    decide: vi.fn(async () => openDecision()),
    submit: vi.fn(async () => "sig123"),
    persistDecision: vi.fn(),
    ...over,
  };
}

const cfg = { persona: "claude-v1", marketId: 0 };

afterEach(() => {
  delete process.env[DISABLE_ENV];
  vi.restoreAllMocks();
});

describe("runBotDecision (end-to-end)", () => {
  it("submits an operator-signed decision when the floor passes", async () => {
    const d = deps();
    const res = await runBotDecision(cfg, d);
    expect(res).toEqual({
      status: "sent",
      signature: "sig123",
      args: { action: 1, side: 0, leverage: 10, stakeFracBps: 1000, stopBps: 200, tpBps: 400, confidence: 80 },
    });
    expect(d.submit).toHaveBeenCalledWith({
      persona: "claude-v1",
      marketId: 0,
      args: { action: 1, side: 0, leverage: 10, stakeFracBps: 1000, stopBps: 200, tpBps: 400, confidence: 80 },
    });
    expect(d.persistDecision).toHaveBeenCalledWith(expect.objectContaining({ sent: true }));
  });

  it("does NOT submit when the floor rejects (no stop)", async () => {
    const d = deps({ decide: vi.fn(async () => openDecision({ stopLossPct: 0 })) });
    const res = await runBotDecision(cfg, d);
    expect(res).toEqual({ status: "skip", reason: "StopRequired" });
    expect(d.submit).not.toHaveBeenCalled();
    expect(d.persistDecision).toHaveBeenCalledWith(expect.objectContaining({ sent: false, reason: "StopRequired" }));
  });

  it("does NOT submit when halted", async () => {
    const d = deps({ getBotState: vi.fn(async () => fakeBot({ halted: true })) });
    expect(await runBotDecision(cfg, d)).toEqual({ status: "skip", reason: "Halted" });
    expect(d.submit).not.toHaveBeenCalled();
  });

  it("returns no-decision and never submits when the model yields null", async () => {
    const d = deps({ decide: vi.fn(async () => null) });
    expect(await runBotDecision(cfg, d)).toEqual({ status: "no-decision" });
    expect(d.submit).not.toHaveBeenCalled();
  });

  it("returns no-bot without calling the model when state is missing", async () => {
    const d = deps({ getBotState: vi.fn(async () => null) });
    expect(await runBotDecision(cfg, d)).toEqual({ status: "no-bot" });
    expect(d.decide).not.toHaveBeenCalled();
    expect(d.submit).not.toHaveBeenCalled();
  });
});

describe("startLlmBrain", () => {
  it("is a no-op when DISABLE_ARENA_LLM=true", () => {
    process.env[DISABLE_ENV] = "true";
    const fakeSetInterval = vi.fn();
    const handle = startLlmBrain([cfg], deps(), {
      intervalMs: 1000,
      setInterval: fakeSetInterval as unknown as typeof setInterval,
    });
    expect(fakeSetInterval).not.toHaveBeenCalled();
    handle.stop();
  });

  it("schedules the cadence and runs a decision per bot when enabled", async () => {
    let captured: (() => void) | null = null;
    const fakeSetInterval = vi.fn((fn: () => void) => {
      captured = fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    const d = deps();
    startLlmBrain([cfg], d, {
      intervalMs: 1000,
      setInterval: fakeSetInterval as unknown as typeof setInterval,
    });
    expect(fakeSetInterval).toHaveBeenCalledOnce();
    captured?.();
    await vi.waitFor(() => expect(d.submit).toHaveBeenCalledOnce());
  });
});
