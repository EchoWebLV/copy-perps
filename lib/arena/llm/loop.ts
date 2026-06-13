// lib/arena/llm/loop.ts
//
// The oracle-bot brain loop. Per bot, per cadence tick:
//   read on-chain LlmBot state → build the shared market brief → ask the model →
//   run the TS safety-floor pre-check → if it survives, submit an operator-signed
//   apply_decision to the ER (the program re-enforces the floor as final
//   authority). Reasoning/outcome are persisted for the UI + audit.
//
// runBotDecision is pure orchestration over injected deps (no network/timers) so
// it is fully unit-testable. startLlmBrain wires the cadence + the kill switch;
// it mirrors the crank/ticker lease pattern and is a no-op when disabled.

import type { ArenaLlmBot } from "../decode";
import {
  evaluateDecision,
  type ApplyDecisionArgs,
  type FloorReject,
  type LlmFloorParams,
  type LlmBotLiveState,
} from "./floor";
import type { LlmDecision } from "./schema";

/** Map the on-chain (authoritative) floor params onto the TS pre-check params. */
export function floorParamsFromBot(bot: ArenaLlmBot): LlmFloorParams {
  return {
    maxLeverage: bot.params.maxLeverage,
    minStopBps: bot.params.minStopBps,
    maxStopBps: bot.params.maxStopBps,
    maxStakeFracBps: bot.params.maxStakeFracBps,
    maxTradesPerDay: bot.params.maxTradesPerDay,
    decisionCooldownSecs: bot.params.decisionCooldownSecs,
    confidenceFloor: bot.params.confidenceFloor,
  };
}

export function liveStateFromBot(bot: ArenaLlmBot): LlmBotLiveState {
  return {
    halted: bot.halted,
    tradesToday: bot.tradesToday,
    lastDecisionTs: Math.floor(bot.lastDecisionTsMs / 1000),
  };
}

export interface DecisionRecord {
  persona: string;
  decision: LlmDecision;
  sent: boolean;
  reason?: FloorReject | "Hold";
  args?: ApplyDecisionArgs;
  signature?: string | null;
}

export interface LlmLoopDeps {
  now: () => number; // unix seconds
  getBotState: (persona: string) => Promise<ArenaLlmBot | null>;
  buildBrief: (bot: ArenaLlmBot) => Promise<string>;
  decide: (prompt: string) => Promise<LlmDecision | null>;
  submit: (p: {
    persona: string;
    marketId: number;
    args: ApplyDecisionArgs;
  }) => Promise<string | null>;
  persistDecision?: (rec: DecisionRecord) => Promise<void> | void;
}

export interface BotRunConfig {
  persona: string;
  marketId: number;
}

export type RunResult =
  | { status: "no-bot" }
  | { status: "no-decision" }
  | { status: "skip"; reason: FloorReject | "Hold" }
  | { status: "sent"; args: ApplyDecisionArgs; signature: string | null };

/**
 * One decision cycle for one bot. Reads chain state, asks the model, applies the
 * floor, and submits if the decision survives. Submits NOTHING on a missing bot,
 * a null/failed decision, or any floor rejection — the chain never sees a doomed tx.
 */
export async function runBotDecision(cfg: BotRunConfig, deps: LlmLoopDeps): Promise<RunResult> {
  const bot = await deps.getBotState(cfg.persona);
  if (!bot) return { status: "no-bot" };

  const prompt = await deps.buildBrief(bot);
  const decision = await deps.decide(prompt);
  if (!decision) return { status: "no-decision" };

  const outcome = evaluateDecision(
    decision,
    floorParamsFromBot(bot),
    liveStateFromBot(bot),
    deps.now(),
  );

  if (outcome.kind === "skip") {
    await deps.persistDecision?.({ persona: cfg.persona, decision, sent: false, reason: outcome.reason });
    return { status: "skip", reason: outcome.reason };
  }

  const signature = await deps.submit({
    persona: cfg.persona,
    marketId: cfg.marketId,
    args: outcome.args,
  });
  await deps.persistDecision?.({
    persona: cfg.persona,
    decision,
    sent: true,
    args: outcome.args,
    signature,
  });
  return { status: "sent", args: outcome.args, signature };
}

export const DISABLE_ENV = "DISABLE_ARENA_LLM";

/**
 * Start the brain loop for a roster of bots. No-op when DISABLE_ARENA_LLM=true.
 * Each bot is polled on its own cadence (decisionCooldownSecs) — the cost guard
 * is the cadence, not a per-tick LLM call. The lease/HOLDER guard mirrors
 * lib/arena/crank.ts so dev + prod never double-drive the same bot.
 */
export function startLlmBrain(
  roster: BotRunConfig[],
  deps: LlmLoopDeps,
  opts: { intervalMs: number; setInterval?: typeof setInterval } = { intervalMs: 60_000 },
): { stop: () => void } {
  if (process.env[DISABLE_ENV] === "true") {
    return { stop: () => {} };
  }
  const timer = (opts.setInterval ?? setInterval)(() => {
    for (const cfg of roster) {
      void runBotDecision(cfg, deps).catch((err) =>
        console.warn(`[llm-arena] ${cfg.persona} decision cycle failed:`, err),
      );
    }
  }, opts.intervalMs);
  return { stop: () => clearInterval(timer as ReturnType<typeof setInterval>) };
}
