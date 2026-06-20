// lib/arena/llm/floor.ts
//
// TypeScript mirror of the on-chain safety floor (arena-program paper_llm.rs
// `precheck_open`). This runs BEFORE we build/send an apply_decision tx so we
// don't waste a transaction the program would reject — but the on-chain floor
// is the real authority and re-enforces everything. Keep this logic byte-aligned
// with precheck_open: same clamps, same reject conditions, same thresholds. The
// floor.test.ts cases mirror paper_llm.rs's tests (parity by shared cases).

import {
  DECISION_ACTION,
  DECISION_SIDE,
  type LlmAction,
  type LlmDecision,
  toBps,
  toConfidence100,
} from "./schema";

/** Minimum leverage on every OPEN. The model's choice is clamped UP to this
 *  (and down to the bot's maxLeverage). Bots are meant to take real swings, not
 *  toe in at 2x. Capped at maxLeverage so it can never exceed the bot's ceiling. */
export const MIN_OPEN_LEVERAGE = 10;

export interface LlmFloorParams {
  maxLeverage: number;
  minStopBps: number;
  maxStopBps: number;
  maxStakeFracBps: number;
  maxTradesPerDay: number;
  decisionCooldownSecs: number;
  confidenceFloor: number; // 0..100
}

export interface LlmBotLiveState {
  halted: boolean;
  tradesToday: number;
  lastDecisionTs: number; // unix seconds
}

export type FloorReject = "Halted" | "Cooldown" | "TradeCap" | "StopRequired" | "LowConfidence";

/** Args for the on-chain apply_decision instruction (all integers). */
export interface ApplyDecisionArgs {
  action: number; // DECISION_ACTION
  side: number; // DECISION_SIDE
  leverage: number; // clamped to maxLeverage
  stakeFracBps: number; // clamped to maxStakeFracBps
  stopBps: number;
  tpBps: number;
  confidence: number; // 0..100
}

export type FloorOutcome =
  | { kind: "send"; args: ApplyDecisionArgs }
  | { kind: "skip"; reason: FloorReject | "Hold" };

/**
 * Decide whether (and how) to submit a single action to the chain. CLOSE is
 * always allowed (risk reduction); HOLD never sends; OPEN passes the full floor.
 * Clamps leverage/stake exactly like the program so the pre-check and the
 * on-chain result agree.
 */
export function evaluateAction(
  decision: LlmAction,
  params: LlmFloorParams,
  state: LlmBotLiveState,
  nowSecs: number,
): FloorOutcome {
  const side = DECISION_SIDE[decision.side];

  if (decision.action === "hold") {
    return { kind: "skip", reason: "Hold" };
  }

  if (decision.action === "close") {
    return {
      kind: "send",
      args: {
        action: DECISION_ACTION.close,
        side,
        leverage: 0,
        stakeFracBps: 0,
        stopBps: 0,
        tpBps: 0,
        confidence: toConfidence100(decision.confidence),
      },
    };
  }

  // OPEN — full floor.
  if (state.halted) return { kind: "skip", reason: "Halted" };
  if (nowSecs - state.lastDecisionTs < params.decisionCooldownSecs) {
    return { kind: "skip", reason: "Cooldown" };
  }
  if (state.tradesToday >= params.maxTradesPerDay) {
    return { kind: "skip", reason: "TradeCap" };
  }

  const confidence = toConfidence100(decision.confidence);
  if (confidence < params.confidenceFloor) {
    return { kind: "skip", reason: "LowConfidence" };
  }

  const rawStop = toBps(decision.stopLossPct);
  if (rawStop === 0) return { kind: "skip", reason: "StopRequired" };
  // Clamp a non-zero stop into the safe band (mirrors the on-chain precheck) so
  // the bot trades with a guaranteed-sane stop instead of being rejected.
  const stopBps = Math.min(Math.max(rawStop, params.minStopBps), params.maxStopBps);

  // Clamp the model's leverage UP to MIN_OPEN_LEVERAGE and DOWN to maxLeverage.
  // minLeverage never exceeds maxLeverage, so a low cap can't create a conflict.
  const maxLeverage = Math.max(1, params.maxLeverage);
  const minLeverage = Math.min(MIN_OPEN_LEVERAGE, maxLeverage);
  const leverage = Math.min(Math.max(decision.leverage, minLeverage), maxLeverage);
  const stakeFracBps = Math.min(toBps(decision.stakeFracPct), params.maxStakeFracBps);
  const tpBps = toBps(decision.takeProfitPct);

  return {
    kind: "send",
    args: {
      action: DECISION_ACTION.open,
      side,
      leverage,
      stakeFracBps,
      stopBps,
      tpBps,
      confidence,
    },
  };
}

export interface ActionOutcome {
  asset: LlmAction["asset"];
  outcome: FloorOutcome;
}

/** Evaluate every action in a tick. Opens draw down a running daily-trade
 *  budget so a multi-open tick stops submitting once the cap is hit (matches
 *  the on-chain sequential trades_today increment). CLOSE/HOLD never consume
 *  the budget. Cooldown is checked against the pre-tick lastDecisionTs, so a
 *  multi-open tick requires decisionCooldownSecs = 0 (see the spec). */
export function evaluateActions(
  decision: LlmDecision,
  params: LlmFloorParams,
  state: LlmBotLiveState,
  nowSecs: number,
): ActionOutcome[] {
  let opensSoFar = 0;
  return decision.actions.map((action) => {
    const liveForAction: LlmBotLiveState = {
      ...state,
      tradesToday: state.tradesToday + opensSoFar,
    };
    const outcome = evaluateAction(action, params, liveForAction, nowSecs);
    if (outcome.kind === "send" && outcome.args.action === DECISION_ACTION.open) {
      opensSoFar += 1;
    }
    return { asset: action.asset, outcome };
  });
}
