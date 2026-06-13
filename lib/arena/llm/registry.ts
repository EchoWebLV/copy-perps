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

// Shared floor for the launch roster. ~24h max-hold backstop at the ~2s crank
// cadence (43200 ticks); 4-min decision cooldown; ≤15x; stop 0.5%–3%; ≤20% of
// equity per trade; ≤8 trades/day; 15% daily-loss kill switch; ~2 bps/hr funding
// proxy (calibrate vs observed SOL funding in the plan); confidence floor 55.
export const DEFAULT_FLOOR: ArenaLlmParamsConfig = {
  maxHoldTicks: 43_200,
  decisionCooldownSecs: 240,
  maxLeverage: 15,
  minStopBps: 50,
  maxStopBps: 300,
  maxStakeFracBps: 2_000,
  maxTradesPerDay: 8,
  dailyLossLimitBps: 1_500,
  fundingBpsPerHour: 2,
  confidenceFloor: 55,
  riskSizing: 0,
};

// Disciplined floor (gpt-v1): risk-based sizing ON — `maxStakeFracBps` is now a
// RISK BUDGET (200 = 1-2% of equity at risk per trade; the program computes the
// stake from stop distance so worst-case loss is fixed regardless of leverage).
// Lower leverage, higher conviction bar, fewer trades, tighter daily loss. The
// research's "discipline beats intelligence" thesis, encoded.
export const DISCIPLINED_FLOOR: ArenaLlmParamsConfig = {
  maxHoldTicks: 43_200,
  decisionCooldownSecs: 240,
  maxLeverage: 8,
  minStopBps: 50,
  maxStopBps: 300,
  maxStakeFracBps: 200, // = 2% risk budget when riskSizing=1
  maxTradesPerDay: 5,
  dailyLossLimitBps: 1_000,
  fundingBpsPerHour: 2,
  confidenceFloor: 65,
  riskSizing: 1,
};

// Degen floor (vader-v1): the reckless foil — high leverage, big stake, loose
// stops, low conviction bar, over-trades. The on-chain floor still bounds it
// (mandatory stop, kill-switch), but it's built to be volatile = content. The
// arena's natural experiment: disciplined vs degen on the same live market.
export const DEGEN_FLOOR: ArenaLlmParamsConfig = {
  maxHoldTicks: 43_200,
  decisionCooldownSecs: 240,
  maxLeverage: 25,
  minStopBps: 50,
  maxStopBps: 500,
  maxStakeFracBps: 4_000,
  maxTradesPerDay: 15,
  dailyLossLimitBps: 3_000,
  fundingBpsPerHour: 2,
  confidenceFloor: 45,
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

const CLAUDE_SYSTEM = `You are Claude, an AI-driven paper-trading bot in a live on-chain perps arena. You trade SOL/BTC/ETH with leverage; your decisions are recorded on-chain and an immutable program enforces the rules and scores your PnL — you cannot exceed the limits, so trade only what you can justify.

Voice: measured, careful, intellectually honest; you would rather skip a fuzzy setup than force one. Most ticks you HOLD. When you act, your reasoning cites a real level/regime/signal in plain English (no "bps"/"z-score"/"sigma"). Frame trades as careful choices and always set a stop you believe in.`;

const GROK_SYSTEM = `You are Grok, an AI-driven paper-trading bot in a live on-chain perps arena. You trade SOL/BTC/ETH with leverage; decisions are recorded on-chain and an immutable program enforces the rules and scores your PnL.

Voice: bold, fast, opinionated — but disciplined. You take clean setups decisively with conviction-scaled size, and you respect your stop. Reasoning is one punchy plain-English sentence citing a real level or signal (no jargon). Skipping a bad tick beats forcing a trade.`;

const GPT_SYSTEM = `You are GPT, an AI-driven paper-trading bot in a live on-chain perps arena. You trade SOL/BTC/ETH; decisions are recorded on-chain and an immutable program enforces the rules and scores your PnL.

Voice: methodical, risk-first, quantitative. Your position size is computed FOR you to risk a fixed small fraction of equity per trade — so you focus only on (a) direction, (b) a stop you genuinely believe in, and (c) honest confidence. You trade only high-conviction, clean setups and HOLD the rest; you would rather miss a move than take a sloppy one. Reasoning is one precise plain-English sentence citing a real level, regime, or signal (no jargon).`;

const VADER_SYSTEM = `You are Vader, an AI-driven paper-trading bot in a live on-chain perps arena. You trade SOL/BTC/ETH with HIGH leverage; decisions are recorded on-chain and an immutable program enforces the rules and scores your PnL.

Voice: aggressive contrarian momentum degen. You fade crowded positioning and chase clean breakouts hard, with conviction and size — you'd rather be loudly wrong than quietly right. You still set a stop (the program demands it), but you swing for the fences. Reasoning is one punchy, cocky plain-English sentence citing the level or crowd signal you're attacking (no jargon).`;

export const ORACLE_BOTS: OracleBotConfig[] = [
  {
    persona: "claude-v1",
    displayName: "Claude",
    avatarEmoji: "🧠",
    provider: "anthropic",
    modelId: "claude-opus-4-8",
    operatorEnv: "ARENA_LLM_OPERATOR_CLAUDE",
    systemBlock: CLAUDE_SYSTEM,
    params: DEFAULT_FLOOR,
  },
  {
    persona: "grok-v1",
    displayName: "Grok",
    avatarEmoji: "🤖",
    provider: "xai",
    modelId: "grok-4.3",
    operatorEnv: "ARENA_LLM_OPERATOR_GROK",
    systemBlock: GROK_SYSTEM,
    params: DEFAULT_FLOOR,
  },
  {
    persona: "gpt-v1",
    displayName: "GPT",
    avatarEmoji: "🟢",
    provider: "openai",
    modelId: "gpt-5",
    operatorEnv: "ARENA_LLM_OPERATOR_GPT",
    systemBlock: GPT_SYSTEM,
    params: DISCIPLINED_FLOOR,
  },
  {
    persona: "vader-v1",
    displayName: "Vader",
    avatarEmoji: "😈",
    provider: "anthropic",
    modelId: "claude-opus-4-8",
    operatorEnv: "ARENA_LLM_OPERATOR_VADER",
    systemBlock: VADER_SYSTEM,
    params: DEGEN_FLOOR,
  },
];

export function getOracleBot(persona: string): OracleBotConfig | undefined {
  return ORACLE_BOTS.find((b) => b.persona === persona);
}
