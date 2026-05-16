// lib/bots/strategies/atlas.ts
//
// Atlas — was the "always-long max-leverage SP500 scalper" archetype
// (same R:R inversion problem as Bullion, same expected bust).
//
// Rewired 2026-05-15 to use a documented edge instead: the
// Bessembinder overnight-drift trade. Long SP500 from 16:00 ET (cash
// close) to 09:30 ET (cash open) on weekdays. ~95% of long-term SPX
// return historically comes from overnight; intraday is near-zero.
// One trade per session, 10x lev. Same bot id and persona —
// the voice stays "eternal bull" but now grounded in a real cycle.

import type { BotConfig } from "../types";
import { OvernightSP500Strategy } from "./overnight-sp500";

export const AtlasStrategy = OvernightSP500Strategy;

export const AtlasBot: BotConfig = {
  id: "atlas",
  parentId: null,
  name: "Atlas",
  avatarEmoji: "📈",
  personaVoiceKey: "atlas",
  // strategyKey stays "atlas" — the registry maps it to
  // OvernightSP500Strategy via lib/bots/index.ts.
  strategyKey: "atlas",
  config: {
    strategy: "overnight-sp500",
    asset: "SP500",
    entryHourEt: 16.0,
    exitHourEt: 9.5,
    leverage: 10,
    hardStopPct: 0.015,
    maxHoldMs: 18 * 60 * 60 * 1000,
    cooldownAfterCloseMs: 4 * 60 * 60 * 1000,
    stopLossPct: 0.9,
  },
  status: "paper",
};
