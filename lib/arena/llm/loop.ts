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
  evaluateActions,
  type ApplyDecisionArgs,
  type FloorReject,
  type LlmFloorParams,
  type LlmBotLiveState,
} from "./floor";
import type { ArenaAsset, LlmAction, LlmDecision } from "./schema";

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
  asset: ArenaAsset;
  decision: LlmAction;
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
    asset: ArenaAsset;
    args: ApplyDecisionArgs;
  }) => Promise<string | null>;
  persistDecision?: (rec: DecisionRecord) => Promise<void> | void;
}

export interface BotRunConfig {
  persona: string;
  marketId: number;
}

/** The asset the day-roll heartbeat targets — SOL routes to the original live
 *  market 0, the same market the heartbeat has always advanced. */
const HEARTBEAT_ASSET: ArenaAsset = "SOL";

export interface ActionResult {
  asset: ArenaAsset;
  signature: string | null;
  args: ApplyDecisionArgs;
}

export type RunResult =
  | { status: "no-bot" }
  | { status: "no-decision" }
  | { status: "skip"; reason: FloorReject | "Hold" }
  | { status: "heartbeat"; signature: string | null }
  | { status: "acted"; results: ActionResult[] };

const DAY_SECS = 86_400; // mirror arena-program paper_llm.rs DAY_SECS

/** True when the on-chain daily window is stale — i.e. the program's roll_day()
 *  would advance it (a different UTC day than `dayStartTsMs`, or an unset 0).
 *  Mirrors roll_day's same-day guard exactly (div by day, with 0 == "first use"). */
export function dayNeedsRoll(dayStartTsMs: number, nowSecs: number): boolean {
  if (!dayStartTsMs || dayStartTsMs <= 0) return true;
  return Math.floor(dayStartTsMs / (DAY_SECS * 1000)) !== Math.floor(nowSecs / DAY_SECS);
}

/** The apply_decision args for a HOLD heartbeat (action=0). The program runs
 *  roll_day() before the action match and treats HOLD as a no-op, so this is a
 *  pure "advance the daily window / clear a stale halt" tx — never a trade. */
const HEARTBEAT_ARGS: ApplyDecisionArgs = {
  action: 0,
  side: 0,
  leverage: 0,
  stakeFracBps: 0,
  stopBps: 0,
  tpBps: 0,
  confidence: 0,
};

/**
 * One decision cycle for one bot. Reads chain state, asks the model, applies the
 * floor, and submits if the decision survives. Submits NOTHING on a missing bot,
 * a null/failed decision, or any floor rejection — the chain never sees a doomed tx.
 */
export async function runBotDecision(cfg: BotRunConfig, deps: LlmLoopDeps): Promise<RunResult> {
  const bot = await deps.getBotState(cfg.persona);
  if (!bot) return { status: "no-bot" };

  // Daily heartbeat (must run before the model call): when the on-chain day is
  // stale, submit a HOLD heartbeat so the program's roll_day() rebaselines the
  // loss limit, zeroes trades_today, and CLEARS a stale halt. Without this a bot
  // that only ever HOLDs never sends a tx, so roll_day never runs and a once-
  // halted bot stays halted forever (the gpt-v1 deadlock). Skipping the model
  // here also avoids a wasted LLM call when the bot is wedged. Next tick the bot
  // reads back un-halted with a fresh window and resumes normal decisions.
  if (dayNeedsRoll(bot.dayStartTsMs, deps.now())) {
    const signature = await deps.submit({ persona: cfg.persona, asset: HEARTBEAT_ASSET, args: HEARTBEAT_ARGS });
    return { status: "heartbeat", signature };
  }

  const prompt = await deps.buildBrief(bot);
  const decision = await deps.decide(prompt);
  if (!decision) return { status: "no-decision" };

  const outcomes = evaluateActions(
    decision,
    floorParamsFromBot(bot),
    liveStateFromBot(bot),
    deps.now(),
  );

  const sends = outcomes.filter((o) => o.outcome.kind === "send");
  if (sends.length === 0) {
    // Persist every skip for the UI "why" layer, then no-op for the tick.
    for (const o of outcomes) {
      if (o.outcome.kind === "skip") {
        await deps.persistDecision?.({
          persona: cfg.persona,
          asset: o.asset,
          decision: pickAction(decision, o.asset),
          sent: false,
          reason: o.outcome.reason,
        });
      }
    }
    const first = outcomes[0]?.outcome;
    return { status: "skip", reason: first?.kind === "skip" ? first.reason : "Hold" };
  }

  const results: ActionResult[] = [];
  for (const o of sends) {
    if (o.outcome.kind !== "send") continue;
    const signature = await deps.submit({ persona: cfg.persona, asset: o.asset, args: o.outcome.args });
    await deps.persistDecision?.({
      persona: cfg.persona,
      asset: o.asset,
      decision: pickAction(decision, o.asset),
      sent: true,
      args: o.outcome.args,
      signature,
    });
    results.push({ asset: o.asset, signature, args: o.outcome.args });
  }
  return { status: "acted", results };
}

/** The action for an asset that the persistence record should narrate (the
 *  first action targeting that asset; falls back to the first action). */
function pickAction(decision: LlmDecision, asset: ArenaAsset): LlmAction {
  return decision.actions.find((a) => a.asset === asset) ?? decision.actions[0];
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
