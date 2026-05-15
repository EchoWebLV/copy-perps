// lib/bots/strategies/bullion.ts
//
// Bullion — was the "always-long max-leverage gold scalper" archetype
// (terrible R:R, ~70% breakeven win rate, expected bust).
//
// Rewired 2026-05-15 to use a documented edge instead: 4h mean
// reversion on XAU. Fade 2σ stretches, hold up to 12h, TP 0.8%, SL
// 1.2%. ~50% breakeven win rate, real EV. Same bot id and persona —
// the voice just becomes "patient fader" rather than "eternal bull."

import type { BotConfig } from "../types";
import { GoldMeanRevertStrategy } from "./gold-mean-revert";

export const BullionStrategy = GoldMeanRevertStrategy;

export const BullionBot: BotConfig = {
  id: "bullion",
  parentId: null,
  name: "Bullion",
  avatarEmoji: "🪙",
  personaVoiceKey: "bullion",
  // strategyKey stays "bullion" — the registry maps it to
  // GoldMeanRevertStrategy via lib/bots/index.ts.
  strategyKey: "bullion",
  config: {
    strategy: "gold-mean-revert",
    asset: "XAU",
    timeframe: "4h",
    candleCount: 24,
    zEntryThreshold: 2.0,
    tpPricePct: 0.008,
    slPricePct: 0.012,
    maxHoldMs: 12 * 60 * 60 * 1000,
    cooldownAfterCloseMs: 60 * 60 * 1000,
    stakePctOverride: 0.5,
    minLeverage: 4,
    maxLeverage: 8,
    stopLossPct: 0.9,
  },
  status: "paper",
};
