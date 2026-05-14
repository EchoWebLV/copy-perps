// lib/bots/index.ts
import type { BotConfig, Strategy } from "./types";

// In-memory registry of all bots known to the system. Database `bots` rows
// are the source of truth for status/parameters; this map provides the
// strategy + persona implementations that DB rows reference by key.
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

// Bot strategy implementations register themselves on import. Phase 1 ships
// Liquidation Lizard only; Phase 2 adds the rest.
import "./strategies/liquidation-lizard";
