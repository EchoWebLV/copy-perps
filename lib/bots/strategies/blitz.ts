// lib/bots/strategies/blitz.ts
//
// Blitz — medium-speed crypto momentum / breakout bot. Reuses the
// momo-max engine (breakout candle body + volume spike, conviction-
// scaled leverage) on a 15m timeframe: fires when a 15-minute candle's
// body clears ~0.6% on >=1.4x volume while the regime is trending or
// vol-expanding, rides ~90 min, exits on a 1% favorable move.
//
// Tuned to aim for ~10-15 trades/day at 10-30x leverage. The actual
// rate floats with market volatility — retune breakoutPct /
// volumeMultiplier after a day of live ticks if it over/under-fires.

import type { BotConfig } from "../types";
import type { Regime } from "../regime";
import { createMomoMaxStrategy } from "./momo-max";

const REGIMES: Regime[] = ["trending-up", "trending-down", "vol-expanding"];

const BLITZ_CONFIG = {
  timeframe: "15m" as const,
  candleCount: 12,
  breakoutPct: 0.006,
  volumeMultiplier: 1.4,
  exitFavorablePct: 0.01,
  maxHoldMs: 90 * 60 * 1000,
  leverage: 20,
  minLeverage: 10,
  maxLeverage: 30,
  regimesAllowed: REGIMES,
};

export const BlitzStrategy = createMomoMaxStrategy({
  id: "blitz",
  ...BLITZ_CONFIG,
});

export const BlitzBot: BotConfig = {
  id: "blitz",
  parentId: null,
  name: "Blitz",
  avatarEmoji: "🚀",
  personaVoiceKey: "blitz",
  strategyKey: "blitz",
  config: { ...BLITZ_CONFIG },
  status: "paper",
};
