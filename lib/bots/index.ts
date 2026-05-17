// lib/bots/index.ts
import type { BotConfig, Strategy } from "./types";
import { buildStrategyFromBot } from "./factories";
// Active roster: 9 bots.
// - WHALE / ORCA / LEVIATHAN / MEGALODON: each bundles 3 super-active
//   whales behind one composite source (see strategies/whale.ts).
// - PULSE:   X (Twitter) catalyst trader via Grok 4.3 (LLM)
// - BULLION: 4h gold mean-reversion (algorithmic)
// - ATLAS:   overnight SP500 drift (algorithmic)
// - BLITZ:   15m crypto momentum/breakout (algorithmic)
// - TILT:    degen revenge trader — momentum + martingale leverage
//
// NATIVE and KRAKEN are retired as standalone bots — their wallets are
// whales inside the WHALE bundle. SNIPER is benched. Their strategy and
// persona files stay in the codebase, dormant. All older bots (Vulture,
// Contrarian, Shadow, Grok, Claude, etc.) likewise remain as dormant
// files in case we want to revive any.
import { WhaleStrategy, WhaleBot } from "./strategies/whale";
import { OrcaStrategy, OrcaBot } from "./strategies/orca";
import { LeviathanStrategy, LeviathanBot } from "./strategies/leviathan";
import { MegalodonStrategy, MegalodonBot } from "./strategies/megalodon";
import { PulseStrategy, PulseBot } from "./strategies/pulse";
import { BullionStrategy, BullionBot } from "./strategies/bullion";
import { AtlasStrategy, AtlasBot } from "./strategies/atlas";
import { BlitzStrategy, BlitzBot } from "./strategies/blitz";
import { TiltStrategy, TiltBot } from "./strategies/tilt";

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

// Active roster — 9 bots. Native, Kraken and Sniper are retired /
// benched; their files stay dormant in the codebase.
registerBot(WhaleBot, WhaleStrategy); // Whale (3-whale bundle)
registerBot(OrcaBot, OrcaStrategy); // Orca (3-whale bundle)
registerBot(LeviathanBot, LeviathanStrategy); // Leviathan (3-whale bundle)
registerBot(MegalodonBot, MegalodonStrategy); // Megalodon (3-whale bundle)
registerBot(PulseBot, PulseStrategy); // Pulse (Grok 4.3 + X live search)
registerBot(BullionBot, BullionStrategy); // Bullion (4h gold mean-reversion)
registerBot(AtlasBot, AtlasStrategy); // Atlas (overnight SP500 drift)
registerBot(BlitzBot, BlitzStrategy); // Blitz (15m crypto momentum/breakout)
registerBot(TiltBot, TiltStrategy); // Tilt (degen revenge trader)
