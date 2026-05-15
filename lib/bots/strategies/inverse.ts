// lib/bots/strategies/inverse.ts
//
// Wraps any Strategy in a mirror that flips entry side (long ↔ short)
// while preserving asset, leverage, conviction, and triggerMeta. Used
// for the Anti-Surge / Anti-Fade test bots: if the base bot has a
// strongly negative gross edge (loss > 2× friction), the mirror should
// have a strongly positive one. Same trigger logic, opposite direction.
//
// Exit logic is its own Strategy so the mirror tracks the *flipped*
// position's PnL correctly — we delegate to a fresh exit eval that
// computes favorable move from the flipped side. That said, since
// resolver.evaluateExit only receives the persisted PaperPosition (which
// already has the flipped side recorded), the base strategy's exit
// math works as-is.

import type {
  EntryDecision,
  ExternalSignals,
  MarketContext,
  PaperPosition,
  Strategy,
} from "../types";

export function createInverseStrategy(
  baseStrategy: Strategy,
  opts: { id: string },
): Strategy {
  return {
    id: opts.id,
    markets: baseStrategy.markets,

    async evaluateEntry(
      ctx: MarketContext,
      signals: ExternalSignals,
    ): Promise<EntryDecision | null> {
      const decision = await baseStrategy.evaluateEntry(ctx, signals);
      if (!decision) return null;
      const flippedSide: "long" | "short" =
        decision.side === "long" ? "short" : "long";
      return {
        ...decision,
        side: flippedSide,
        triggerMeta: {
          ...decision.triggerMeta,
          inverseOf: baseStrategy.id,
          flippedFromSide: decision.side,
        },
      };
    },

    evaluateExit(ctx: MarketContext, position: PaperPosition): boolean {
      return baseStrategy.evaluateExit(ctx, position);
    },
  };
}
