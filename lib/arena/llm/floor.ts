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
  type LlmDecision,
  toBps,
  toConfidence100,
} from "./schema";

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

export type FloorReject =
  | "Halted"
  | "Cooldown"
  | "TradeCap"
  | "StopRequired"
  | "StopOutOfRange"
  | "LowConfidence";

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
 * Decide whether (and how) to submit a decision to the chain. CLOSE is always
 * allowed (risk reduction); HOLD never sends; OPEN passes the full floor.
 * Clamps leverage/stake exactly like the program so the pre-check and the
 * on-chain result agree.
 */
export function evaluateDecision(
  decision: LlmDecision,
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

  const stopBps = toBps(decision.stopLossPct);
  if (stopBps === 0) return { kind: "skip", reason: "StopRequired" };
  if (stopBps < params.minStopBps || stopBps > params.maxStopBps) {
    return { kind: "skip", reason: "StopOutOfRange" };
  }

  const leverage = Math.min(decision.leverage, Math.max(1, params.maxLeverage));
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
