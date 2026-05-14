// lib/bots/factories.ts
//
// Family → strategy-factory map. Lets the resolver instantiate a strategy
// for any DB-loaded bot row, including admin-cloned variants that aren't
// hardcoded in lib/bots/index.ts. Each factory accepts a flat params object
// shaped like the bot's `config` JSONB plus an `id` field; we cast through
// `unknown` because each factory has its own param type, but the runtime
// shape is consistent (flat scalars, no nesting).

import type { Strategy } from "./types";
import { createLiquidationLizardStrategy } from "./strategies/liquidation-lizard";
import { createFundingPhoebeStrategy } from "./strategies/funding-phoebe";
import { createMeanRevertMikeStrategy } from "./strategies/mean-revert-mike";
import { createMomoMaxStrategy } from "./strategies/momo-max";
import { createVolVectorStrategy } from "./strategies/vol-vector";
import { createBoomerTrendStrategy } from "./strategies/boomer-trend";
import { familyOf } from "./wiring";

// We accept `unknown` for params at the boundary — the wiring metadata in
// wiring.ts lists each family's required knobs, and admin-edit validates
// against that list before persisting. Inside the factory the param types
// are strict.
type AnyFactory = (params: { id: string } & Record<string, unknown>) => Strategy;

const FACTORIES: Record<string, AnyFactory> = {
  "liquidation-lizard": createLiquidationLizardStrategy as unknown as AnyFactory,
  "funding-phoebe": createFundingPhoebeStrategy as unknown as AnyFactory,
  "mean-revert-mike": createMeanRevertMikeStrategy as unknown as AnyFactory,
  "momo-max": createMomoMaxStrategy as unknown as AnyFactory,
  "vol-vector": createVolVectorStrategy as unknown as AnyFactory,
  "boomer-trend": createBoomerTrendStrategy as unknown as AnyFactory,
};

export function getStrategyFamilies(): string[] {
  return Object.keys(FACTORIES);
}

/**
 * Builds a Strategy from a bot's strategyKey + config JSON. The strategyKey
 * is treated as the strategy's unique id; the family (derived from the key
 * via wiring.familyOf) selects the factory. Returns null if no family
 * matches — typically means a stale strategyKey from a bot row whose
 * family was removed from the codebase.
 */
export function buildStrategyFromBot(args: {
  strategyKey: string;
  config: Record<string, unknown>;
}): Strategy | null {
  const family = familyOf(args.strategyKey);
  if (!family) return null;
  const factory = FACTORIES[family];
  if (!factory) return null;
  return factory({ id: args.strategyKey, ...args.config });
}
