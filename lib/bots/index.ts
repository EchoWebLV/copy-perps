// lib/bots/index.ts
import type { BotConfig, Strategy } from "./types";
import { buildStrategyFromBot } from "./factories";
// Active v4 roster: 4 bots, each wrapping a real-world signal source.
// - WHALE: mirrors a top Hyperliquid wallet (source-mirror)
// - NATIVE: mirrors a top Pacifica wallet (source-mirror)
// - SNIPER: fades cross-CEX funding extremes (structural)
// - PULSE: X (Twitter) trend catcher via Grok 4.3 (LLM)
//
// All older bots (Surge/Fade/Bolt/Anti-X, Vulture, Contrarian, Shadow,
// Grok, Claude) remain in the codebase as dormant strategy/persona
// files in case we want to revive any.
import { WhaleStrategy, WhaleBot } from "./strategies/whale";
import { NativeStrategy, NativeBot } from "./strategies/native";
import {
  FundingSniperStrategy,
  FundingSniperBot,
} from "./strategies/funding-sniper";
import { PulseStrategy, PulseBot } from "./strategies/pulse";
import { BullionStrategy, BullionBot } from "./strategies/bullion";
import { AtlasStrategy, AtlasBot } from "./strategies/atlas";

const BOTS = new Map<string, BotConfig>();
const STRATEGIES = new Map<string, Strategy>();

export function registerBot(config: BotConfig, strategy: Strategy): void {
  if (BOTS.has(config.id)) {
    throw new Error(`Bot ${config.id} already registered`);
  }
  BOTS.set(config.id, config);
  STRATEGIES.set(config.strategyKey, strategy);
}

export function getBot(id: string): BotConfig | null {
  return BOTS.get(id) ?? null;
}

export function getStrategy(strategyKey: string): Strategy | null {
  return STRATEGIES.get(strategyKey) ?? null;
}

export function listBots(): BotConfig[] {
  return Array.from(BOTS.values());
}

/**
 * Returns the Strategy instance for a bot. Fast-path hits the static
 * registry populated below; cache-miss (e.g. an admin-cloned variant
 * persisted to the DB after this module loaded) falls through to the
 * factory map and back-fills the registry so subsequent ticks are O(1).
 *
 * Returns null when the bot's strategyKey doesn't map to a known family.
 */
export function resolveStrategyForBot(bot: BotConfig): Strategy | null {
  const cached = STRATEGIES.get(bot.strategyKey);
  if (cached) return cached;
  const built = buildStrategyFromBot({
    strategyKey: bot.strategyKey,
    config: bot.config,
  });
  if (!built) return null;
  STRATEGIES.set(bot.strategyKey, built);
  return built;
}

/**
 * Adds a bot config to the in-memory registry at runtime. Used by the admin
 * clone flow.
 */
export function registerBotDynamic(config: BotConfig): Strategy | null {
  const existing = BOTS.get(config.id);
  if (existing) return STRATEGIES.get(existing.strategyKey) ?? null;
  const strategy = buildStrategyFromBot({
    strategyKey: config.strategyKey,
    config: config.config,
  });
  if (!strategy) return null;
  BOTS.set(config.id, config);
  STRATEGIES.set(config.strategyKey, strategy);
  return strategy;
}

/**
 * Overwrites both the BOTS and STRATEGIES entries for a bot. Used by the
 * admin edit flow so config changes take effect on the next tick without
 * a dev-server restart.
 */
export function reregisterBotDynamic(config: BotConfig): Strategy | null {
  const strategy = buildStrategyFromBot({
    strategyKey: config.strategyKey,
    config: config.config,
  });
  if (!strategy) return null;
  BOTS.set(config.id, config);
  STRATEGIES.set(config.strategyKey, strategy);
  return strategy;
}

// v4 roster — 4 bots, each wrapping a real-world signal source.
registerBot(WhaleBot, WhaleStrategy); // Whale (HL wallet mirror)
registerBot(NativeBot, NativeStrategy); // Native (Pacifica wallet mirror)
registerBot(FundingSniperBot, FundingSniperStrategy); // Sniper (funding extremes)
registerBot(PulseBot, PulseStrategy); // Pulse (Grok 4.3 + X live search)
registerBot(BullionBot, BullionStrategy); // Bullion (XAU long-only max-leverage scalper)
registerBot(AtlasBot, AtlasStrategy); // Atlas (SP500 long-only max-leverage scalper)
