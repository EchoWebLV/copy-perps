// lib/bots/index.ts
import type { BotConfig, Strategy } from "./types";
import { buildStrategyFromBot } from "./factories";
import {
  LiquidationLizardStrategy,
  LiquidationLizardJrStrategy,
  LiquidationLizardBot,
  LiquidationLizardJrBot,
} from "./strategies/liquidation-lizard";
import {
  FundingPhoebeStrategy,
  FundingPhoebeLiteStrategy,
  FundingPhoebeBot,
  FundingPhoebeLiteBot,
} from "./strategies/funding-phoebe";
import {
  MeanRevertMikeStrategy,
  MeanRevertMikePatientStrategy,
  MeanRevertMikeBot,
  MeanRevertMikePatientBot,
} from "./strategies/mean-revert-mike";
import {
  MomoMaxStrategy,
  MomoMaxAggressiveStrategy,
  MomoMaxBot,
  MomoMaxAggressiveBot,
} from "./strategies/momo-max";
import {
  VolVectorStrategy,
  VolVectorHairTriggerStrategy,
  VolVectorBot,
  VolVectorHairTriggerBot,
} from "./strategies/vol-vector";
import {
  BoomerTrendStrategy,
  BoomerTrendWideStrategy,
  BoomerTrendBot,
  BoomerTrendWideBot,
} from "./strategies/boomer-trend";

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
 * clone flow: after a new bot row is persisted to the DB, calling this lets
 * the resolver's `listBots()` see it on the next tick (in dev, where the
 * Next process is long-lived). Idempotent — no-ops if the id is already
 * registered, returns the existing strategy in that case.
 *
 * Returns null when the strategyKey doesn't map to a known factory family
 * (caller should reject the request before persisting).
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
  // A variant clone reuses the parent family's logic but gets its own
  // strategy instance keyed on the variant's strategyKey, so each bot's
  // config knobs apply independently.
  STRATEGIES.set(config.strategyKey, strategy);
  return strategy;
}

/**
 * Overwrites both the BOTS and STRATEGIES entries for a bot. Used by the
 * admin edit flow so config changes take effect on the next tick without
 * a dev-server restart. Returns null if the strategyKey has no known
 * factory family (caller should reject the request).
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

// Register all 12 bots at module load. Order is informational; the registry
// is keyed on bot.id.
registerBot(LiquidationLizardBot, LiquidationLizardStrategy);
registerBot(LiquidationLizardJrBot, LiquidationLizardJrStrategy);
registerBot(FundingPhoebeBot, FundingPhoebeStrategy);
registerBot(FundingPhoebeLiteBot, FundingPhoebeLiteStrategy);
registerBot(MeanRevertMikeBot, MeanRevertMikeStrategy);
registerBot(MeanRevertMikePatientBot, MeanRevertMikePatientStrategy);
registerBot(MomoMaxBot, MomoMaxStrategy);
registerBot(MomoMaxAggressiveBot, MomoMaxAggressiveStrategy);
registerBot(VolVectorBot, VolVectorStrategy);
registerBot(VolVectorHairTriggerBot, VolVectorHairTriggerStrategy);
registerBot(BoomerTrendBot, BoomerTrendStrategy);
registerBot(BoomerTrendWideBot, BoomerTrendWideStrategy);
