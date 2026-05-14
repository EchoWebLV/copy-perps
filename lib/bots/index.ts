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
