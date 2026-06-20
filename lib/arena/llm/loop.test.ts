import { afterEach, describe, expect, it, vi } from "vitest";
import { DISABLE_ENV, runBotDecision, startLlmBrain, type LlmLoopDeps } from "./loop";
import type { ArenaLlmBot } from "../decode";
import type { LlmAction } from "./schema";

function fakeBot(over: Partial<ArenaLlmBot> = {}): ArenaLlmBot {
  return {
    balanceUsd: 1000,
    grossPnlUsd: 0,
    feesUsd: 0,
    fundingPaidUsd: 0,
    equityHighUsd: 1000,
    dayStartEquityUsd: 1000,
    seq: 0,
    // Same UTC day as the default deps.now() (1_000_000s) so the daily heartbeat
    // does not fire in the baseline cases — real bots always carry a real ts.
    dayStartTsMs: 1_000_000_000,
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
    reasoning: "clean reclaim of $150",
    ...over,
  };
}

function deps(over: Partial<LlmLoopDeps> = {}): LlmLoopDeps {
  return {
    now: () => 1_000_000,
    getBotState: vi.fn(async () => fakeBot()),
    buildBrief: vi.fn(async () => "BRIEF"),
    decide: vi.fn(async () => ({ actions: [openDecision()] })),
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
    expect(res.status).toBe("acted");
    expect(d.submit).toHaveBeenCalledWith({
      persona: "claude-v1",
      asset: "SOL",
      args: { action: 1, side: 0, leverage: 10, stakeFracBps: 1000, stopBps: 200, tpBps: 400, confidence: 80 },
    });
    expect(d.persistDecision).toHaveBeenCalledWith(expect.objectContaining({ sent: true, asset: "SOL" }));
  });

  it("submits one routed apply_decision per surviving action", async () => {
    const d = deps({
      decide: vi.fn(async () => ({
        actions: [
          { action: "open", side: "long", asset: "BTC", leverage: 10, stakeFracPct: 0.1,
            stopLossPct: 0.02, takeProfitPct: 0.04, confidence: 0.8, reasoning: "a" },
          { action: "close", side: "long", asset: "SOL", leverage: 1, stakeFracPct: 0,
            stopLossPct: 0.01, takeProfitPct: 0, confidence: 0.6, reasoning: "b" },
        ],
      })),
    });
    const res = await runBotDecision(cfg, d);
    expect(res.status).toBe("acted");
    expect(d.submit).toHaveBeenCalledTimes(2);
    expect((d.submit as any).mock.calls[0][0].asset).toBe("BTC");
    expect((d.submit as any).mock.calls[1][0].asset).toBe("SOL");
  });

  it("submits nothing for an all-hold (empty) tick", async () => {
    const d = deps({ decide: vi.fn(async () => ({ actions: [] })) });
    const res = await runBotDecision(cfg, d);
    expect(res.status).toBe("skip");
    expect(d.submit).not.toHaveBeenCalled();
  });

  it("does NOT submit when the floor rejects (no stop)", async () => {
    const d = deps({ decide: vi.fn(async () => ({ actions: [openDecision({ stopLossPct: 0 })] })) });
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

  // Daily heartbeat: when the on-chain day window is stale, the bot MUST submit a
  // HOLD heartbeat (apply_decision action=0) so the program's roll_day() runs —
  // it rebaselines the loss limit, zeroes trades_today, and CLEARS a stale halt.
  // Without it a hold-only/halted bot never sends a tx, so roll_day never runs
  // and it stays halted forever (the gpt-v1 deadlock).
  const HEARTBEAT_ARGS = { action: 0, side: 0, leverage: 0, stakeFracBps: 0, stopBps: 0, tpBps: 0, confidence: 0 };

  it("sends a HOLD heartbeat and skips the model when the on-chain day is stale", async () => {
    const staleDay = 9 * 86_400_000; // day 9; now() = 1_000_000s is day 11
    const d = deps({ getBotState: vi.fn(async () => fakeBot({ dayStartTsMs: staleDay })) });
    const res = await runBotDecision(cfg, d);
    expect(res).toEqual({ status: "heartbeat", signature: "sig123" });
    expect(d.decide).not.toHaveBeenCalled();
    expect(d.submit).toHaveBeenCalledWith({ persona: "claude-v1", asset: "SOL", args: HEARTBEAT_ARGS });
  });

  it("heartbeats a stale-day halted bot instead of skipping on Halted (the unwedge)", async () => {
    const staleDay = 9 * 86_400_000;
    const d = deps({
      getBotState: vi.fn(async () => fakeBot({ halted: true, tradesToday: 10, dayStartTsMs: staleDay })),
    });
    const res = await runBotDecision(cfg, d);
    expect(res).toEqual({ status: "heartbeat", signature: "sig123" });
    expect(d.submit).toHaveBeenCalledOnce();
  });

  it("does NOT heartbeat a halted bot within the same UTC day (halt must persist until the day rolls)", async () => {
    const d = deps({ getBotState: vi.fn(async () => fakeBot({ halted: true, dayStartTsMs: 1_000_000_000 })) });
    const res = await runBotDecision(cfg, d);
    expect(res).toEqual({ status: "skip", reason: "Halted" });
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
    const calls: Array<() => void> = [];
    const fakeSetInterval = vi.fn((fn: () => void) => {
      calls.push(fn);
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    const d = deps();
    startLlmBrain([cfg], d, {
      intervalMs: 1000,
      setInterval: fakeSetInterval as unknown as typeof setInterval,
    });
    expect(fakeSetInterval).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(1);
    calls[0]();
    await vi.waitFor(() => expect(d.submit).toHaveBeenCalledOnce());
  });
});
