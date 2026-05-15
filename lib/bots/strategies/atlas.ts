// lib/bots/strategies/atlas.ts
//
// Atlas — S&P 500 (SP500) long-only max-leverage scalper. Mirrors
// the eternal-bull thesis: "stocks only go up." Same scalper chassis
// as Bullion, different asset. 80% of bankroll committed per trade.

import { buildScalperBot } from "./scalper";

const built = buildScalperBot({
  id: "atlas",
  name: "Atlas",
  avatarEmoji: "📈",
  personaVoiceKey: "atlas",
  asset: "SP500",
  side: "long",
  maxLeverage: 10,
  stakePctOverride: 0.8,
  tpPricePct: 0.003, // SP500 moves smaller — 0.3% TP = ~2-3% on stake
  slPricePct: 0.005, // 0.5% SL = ~4-5% on stake
  maxHoldMs: 60 * 60 * 1000,
  cooldownAfterCloseMs: 5 * 60 * 1000,
});

export const AtlasStrategy = built.strategy;
export const AtlasBot = built.bot;
