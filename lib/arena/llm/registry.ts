// lib/arena/llm/registry.ts
//
// The LLM oracle-bot roster. Each entry is the off-chain config for one bot:
// model + operator-key env + persona system block + the on-chain safety-floor
// params it is initialized with (init_llm_bot). Adding a model = adding a row
// here + running scripts/arena/init-llm-bots.ts — no new program/code.
//
// ARENA FAIRNESS: every bot shares the SAME floor params + the same shared brief
// — the model (and persona voice) is the only variable. claude-v1 and grok-v1
// below differ ONLY in provider/model/voice.

import type { LlmProvider } from "./client";

/** init_llm_bot `params` arg (camelCase keys match the generated IDL type). */
export interface ArenaLlmParamsConfig {
  maxHoldTicks: number;
  decisionCooldownSecs: number;
  maxLeverage: number;
  minStopBps: number;
  maxStopBps: number;
  maxStakeFracBps: number;
  maxTradesPerDay: number;
  dailyLossLimitBps: number;
  fundingBpsPerHour: number;
  confidenceFloor: number; // 0..100
  riskSizing: number; // 0 | 1
}

// THE shared floor for EVERY bot. The arena is a controlled experiment: same
// prompt, same risk limits, same market data for all bots — the only variable
// is the model. Keep these byte-identical to scripts/arena/bot-tuning.ts (the
// live values pushed on-chain via `npm run arena:tune`).
export const DEFAULT_FLOOR: ArenaLlmParamsConfig = {
  maxHoldTicks: 43_200,
  decisionCooldownSecs: 180,
  maxLeverage: 15,
  minStopBps: 50,
  maxStopBps: 300,
  maxStakeFracBps: 1_500,
  maxTradesPerDay: 10,
  dailyLossLimitBps: 1_500,
  fundingBpsPerHour: 2,
  confidenceFloor: 40,
  riskSizing: 0,
};

export interface OracleBotConfig {
  persona: string; // on-chain persona_id seed (≤16 bytes utf8)
  displayName: string;
  avatarEmoji: string;
  provider: LlmProvider;
  modelId: string;
  operatorEnv: string; // env var holding this bot's operator secret key (JSON array)
  systemBlock: string; // static persona/role prompt block
  params: ArenaLlmParamsConfig;
}

// ONE shared prompt for every bot. The arena is a controlled experiment: the
// model is the only variable, so the prompt, risk limits, and market data are
// identical across all bots. No per-persona voice — each model trades on its
// own read of the same tape.
const SHARED_SYSTEM = `You are an AI-driven paper-trading bot in a live on-chain perps arena. You trade SOL/BTC/ETH with leverage; your decisions are recorded on-chain and an immutable program enforces the risk limits and scores your PnL — you cannot exceed the limits.

Every bot in this arena runs on the IDENTICAL prompt, risk limits, and market data — the only difference is the model making the decision, so trade purely on your own read of the tape. Take a position when you see a plausible edge (a level holding, a trend, momentum building, a squeeze) and HOLD only when the tape is genuinely directionless. Always set a stop you believe in. Your reasoning is exactly one plain-English sentence citing a real level, regime, or signal — no jargon (no "bps", "z-score", "sigma").`;

export const ORACLE_BOTS: OracleBotConfig[] = [
  {
    persona: "claude-v1",
    displayName: "Opus 4.8",
    avatarEmoji: "🧠",
    provider: "anthropic",
    modelId: "claude-opus-4-8",
    operatorEnv: "ARENA_LLM_OPERATOR_CLAUDE",
    systemBlock: SHARED_SYSTEM,
    params: DEFAULT_FLOOR,
  },
  {
    persona: "grok-v1",
    displayName: "Grok 4.3",
    avatarEmoji: "🤖",
    provider: "xai",
    modelId: "grok-4.3",
    operatorEnv: "ARENA_LLM_OPERATOR_GROK",
    systemBlock: SHARED_SYSTEM,
    params: DEFAULT_FLOOR,
  },
  {
    persona: "gpt-v1",
    displayName: "GPT-5",
    avatarEmoji: "🟢",
    provider: "openai",
    modelId: "gpt-5",
    operatorEnv: "ARENA_LLM_OPERATOR_GPT",
    systemBlock: SHARED_SYSTEM,
    params: DEFAULT_FLOOR,
  },
  {
    persona: "vader-v1",
    displayName: "Aggressive Opus",
    avatarEmoji: "😈",
    provider: "anthropic",
    modelId: "claude-opus-4-8",
    operatorEnv: "ARENA_LLM_OPERATOR_VADER",
    systemBlock: SHARED_SYSTEM,
    params: DEFAULT_FLOOR,
  },
];

export function getOracleBot(persona: string): OracleBotConfig | undefined {
  return ORACLE_BOTS.find((b) => b.persona === persona);
}
