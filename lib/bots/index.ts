// lib/bots/index.ts
import type { BotConfig, Strategy } from "./types";
import { buildStrategyFromBot } from "./factories";
import {
  MeanRevertMikeStrategy,
  MeanRevertMikeBot,
} from "./strategies/mean-revert-mike";
import {
  MomoMaxAggressiveStrategy,
  MomoMaxAggressiveBot,
} from "./strategies/momo-max";
import {
  VolVectorHairTriggerStrategy,
  VolVectorHairTriggerBot,
} from "./strategies/vol-vector";
import {
  AntiSurgeStrategy,
  AntiSurgeBot,
  AntiFadeStrategy,
  AntiFadeBot,
} from "./strategies/anti-bots";

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

// ── Alpha-arena roster: 3 aggressive bots, all candle-driven, no rare
// external-signal dependencies. The other 9 bot families still live in
// strategies/ as code (admin can clone them back if needed) but aren't
// registered at module load.
registerBot(MomoMaxAggressiveBot, MomoMaxAggressiveStrategy); // Surge
registerBot(MeanRevertMikeBot, MeanRevertMikeStrategy); // Fade
registerBot(VolVectorHairTriggerBot, VolVectorHairTriggerStrategy); // Bolt
registerBot(AntiSurgeBot, AntiSurgeStrategy); // Anti-Surge (mirror of Surge)
registerBot(AntiFadeBot, AntiFadeStrategy); // Anti-Fade (mirror of Fade)
