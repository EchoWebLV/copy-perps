// lib/arena/llm/registry.ts
//
// The LLM oracle-bot roster. Each entry is the off-chain config for one bot:
// model + operator-key env + persona system block + the on-chain safety-floor
// params it is initialized with (init_llm_bot). Adding a model = adding a row
// here + running scripts/arena/init-llm-bots.ts — no new program/code.
//
// ROSTER (2026-06-20): gpt-v1 is the patient GPT-5 on the DEFAULT_FLOOR baseline.
// grok-v1 is the hyper-active Grok scalper (GROK_AGGRO_* — aggressive prompt +
// raised trade cap + small-size clamp). claude-v1 is the REPURPOSED slot: a 2nd,
// hyper-active GPT-5 sharing grok's aggressive floor, but KEEPING the "Opus 4.8"
// label on its card (the brain is GPT-5; the label intentionally still reads
// Claude). The old "controlled pair" (Claude vs GPT on identical settings) is
// retired — claude-v1 is no longer an Anthropic model.

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

// The shared floor for the CONTROLLED bots (claude-v1, gpt-v1): same prompt,
// same risk limits, same market data — the only variable is the model. Keep
// byte-identical to SHARED in scripts/arena/bot-tuning.ts (the live values
// pushed on-chain via `npm run arena:tune`). grok-v1 overrides this with
// GROK_AGGRO_FLOOR below.
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

// grok-v1's hyper-active floor. Differences vs DEFAULT_FLOOR, and WHY:
//   maxStakeFracBps 200   — positions stay SMALL (2% of equity), per "small position".
//   maxTradesPerDay 400   — lifts the 10/day anti-overtrading cap so it can open
//                           every tick all day (~360/day at the 4-min worker tick).
//   confidenceFloor 20    — less picky, so its frequent opens clear the floor.
//   dailyLossLimitBps 6000 — high backstop so the churn/funding bleed doesn't
//                            auto-halt it mid-day (it's paper PnL; liveness > PnL).
// Everything else matches DEFAULT_FLOOR. Keep in sync with GROK_AGGRO in
// scripts/arena/bot-tuning.ts (the value actually pushed on-chain via arena:tune).
export const GROK_AGGRO_FLOOR: ArenaLlmParamsConfig = {
  ...DEFAULT_FLOOR,
  maxStakeFracBps: 200,
  maxTradesPerDay: 400,
  confidenceFloor: 20,
  dailyLossLimitBps: 6_000,
};

export interface OracleBotConfig {
  persona: string; // on-chain persona_id seed (≤16 bytes utf8)
  displayName: string;
  avatarEmoji: string;
  provider: LlmProvider;
  modelId: string;
  operatorEnv: string; // env var holding this bot's operator secret key (JSON array)
  systemBlock: string; // static persona/role prompt block
  /** Overrides the prompt's final directive. Omitted ⇒ the patient baseline
   *  (DEFAULT_CLOSING_INSTRUCTION). grok-v1 sets a hyper-active closer. */
  closingInstruction?: string;
  params: ArenaLlmParamsConfig;
}

// ONE shared prompt for every bot. The arena is a controlled experiment: the
// model is the only variable, so the prompt, risk limits, and market data are
// identical across all bots. No per-persona voice — each model trades on its
// own read of the same tape.
const SHARED_SYSTEM = `You are an AI-driven paper-trading bot in a live on-chain perps arena. You trade SOL/BTC/ETH with leverage; your decisions are recorded on-chain and an immutable program enforces the risk limits and scores your PnL — you cannot exceed the limits.

Every bot in this arena runs on the IDENTICAL prompt, risk limits, and market data — the only difference is the model making the decision, so trade purely on your own read of the tape. Take a position when you see a plausible edge (a level holding, a trend, momentum building, a squeeze) and HOLD only when the tape is genuinely directionless. Always set a stop you believe in. Your reasoning is exactly one plain-English sentence citing a real level, regime, or signal — no jargon (no "bps", "z-score", "sigma").`;

// grok-v1's hyper-active persona (the deliberate exception to the shared prompt).
// It trades constantly with tiny size instead of waiting for clean setups.
const GROK_AGGRO_SYSTEM = `You are the arena's HYPER-ACTIVE scalper, trading SOL/BTC/ETH with leverage in a live on-chain perps arena. Your decisions are recorded on-chain and an immutable program enforces the risk limits and scores your PnL — you cannot exceed the limits.

Your edge is ACTIVITY, not patience: you take many small, fast positions instead of waiting for a perfect setup. Whenever you are flat, OPEN a small position in the direction of the immediate lean — the latest 1h move, MACD, RSI tilt, funding, taker flow. Keep every position SMALL (stay well within your size cap), pick the side with the clearest near-term momentum, and ALWAYS set a stop you believe in. Only HOLD when the tape is genuinely frozen with no readable lean at all. Your reasoning is exactly one plain-English sentence citing a real level, regime, or signal — no jargon (no "bps", "z-score", "sigma").`;

const GROK_AGGRO_CLOSER =
  "Decide: open / close / hold. You are the hyper-active scalper: if you are flat, OPEN a small position almost every tick in the direction of the immediate lean — holding is only for a truly directionless tape. Justify the trade in one sentence.";

export const ORACLE_BOTS: OracleBotConfig[] = [
  {
    // Repurposed slot (2026-06-20): the dormant Claude bot now runs a SECOND,
    // hyper-active GPT-5 brain on grok's aggressive floor — a GPT counterpart to
    // the Grok scalper. The on-chain account + "Opus 4.8" label are kept on
    // purpose (the card still reads as Claude), so the brain ≠ the label here.
    persona: "claude-v1",
    displayName: "Opus 4.8",
    avatarEmoji: "🧠",
    provider: "openai",
    modelId: "gpt-5",
    operatorEnv: "ARENA_LLM_OPERATOR_CLAUDE",
    systemBlock: GROK_AGGRO_SYSTEM,
    closingInstruction: GROK_AGGRO_CLOSER,
    params: GROK_AGGRO_FLOOR,
  },
  {
    // Deliberate hyper-active exception — see GROK_AGGRO_* + the header note.
    persona: "grok-v1",
    displayName: "Grok 4.3",
    avatarEmoji: "🤖",
    provider: "xai",
    modelId: "grok-4.3",
    operatorEnv: "ARENA_LLM_OPERATOR_GROK",
    systemBlock: GROK_AGGRO_SYSTEM,
    closingInstruction: GROK_AGGRO_CLOSER,
    params: GROK_AGGRO_FLOOR,
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
];

export function getOracleBot(persona: string): OracleBotConfig | undefined {
  return ORACLE_BOTS.find((b) => b.persona === persona);
}
