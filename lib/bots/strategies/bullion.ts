// lib/bots/strategies/bullion.ts
//
// Bullion — gold (XAU) long-only max-leverage scalper. Always wants
// to be long XAU. Tight take-profit, slightly wider stop, 80% of
// bankroll committed per trade. The "gold bull who only knows up"
// archetype.

import { buildScalperBot } from "./scalper";

const built = buildScalperBot({
  id: "bullion",
  name: "Bullion",
  avatarEmoji: "🪙",
  personaVoiceKey: "bullion",
  asset: "XAU",
  side: "long",
  // Pacifica caps XAU at ~5-10x typically; clampLeverageForNotional
  // will down-clamp if our 10 is too rich. Either way the resolver
  // applies the actual per-market max at order build time.
  maxLeverage: 10,
  stakePctOverride: 0.8,
  tpPricePct: 0.004, // 0.4% favorable price move = ~3-4% on stake at 8-10x
  slPricePct: 0.007, // 0.7% adverse = ~5-7% on stake
  maxHoldMs: 60 * 60 * 1000,
  cooldownAfterCloseMs: 5 * 60 * 1000,
});

export const BullionStrategy = built.strategy;
export const BullionBot = built.bot;
