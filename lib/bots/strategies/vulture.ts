// lib/bots/strategies/vulture.ts
//
// Fades large liquidation cascades. When ≥$100M of one-sided liquidations
// hit a single asset within 60s, the bot opens counter-direction at the
// implied wick — forced sellers always overshoot fair value, and the
// rebound averages 0.5-1.5% in the first 15-60 minutes.
//
// Edge source: structural inefficiency. A liquidation engine doesn't care
// about price impact; it sells/buys until the position is flat. That's
// price-insensitive flow that overshoots. We step in as the non-forced
// counterparty.
//
// Octane source: only fires during chaos. Most ticks Vulture is silent;
// when carnage hits, the bot fires with high leverage on real conviction.

import type {
  BotConfig,
  EntryDecision,
  ExternalSignals,
  LiquidationEvent,
  MarketContext,
  PaperPosition,
  Strategy,
} from "../types";
import { clampConviction } from "../types";
import { leverageFromConviction } from "../leverage";

const ALLOWED_MARKETS = ["BTC", "ETH", "SOL"] as const;

interface VultureParams {
  id: string;
  cascadeWindowMs: number;        // window over which to sum liq notional (e.g. 60_000)
  minCascadeNotionalUsd: number;  // threshold to fire (e.g. 100_000_000)
  exitFavorablePct: number;        // TP at +X% favorable
  maxHoldMs: number;               // force-close after Y ms
  leverage: number;
  minLeverage?: number;
  maxLeverage?: number;
}

function sumCascade(
  liqs: LiquidationEvent[],
  asset: string,
  side: "long" | "short",
  windowMs: number,
): number {
  const cutoff = Date.now() - windowMs;
  let total = 0;
  for (const l of liqs) {
    if (l.asset !== asset) continue;
    if (l.side !== side) continue;
    if (l.ts < cutoff) continue;
    total += l.notionalUsd;
  }
  return total;
}

export function createVultureStrategy(p: VultureParams): Strategy {
  return {
    id: p.id,
    markets: ALLOWED_MARKETS,

    evaluateEntry(
      ctx: MarketContext,
      signals: ExternalSignals,
    ): EntryDecision | null {
      if (
        !ALLOWED_MARKETS.includes(
          ctx.asset as (typeof ALLOWED_MARKETS)[number],
        )
      ) {
        return null;
      }
      // Look at one-sided cascades. If $X+ of longs liquidated, longs were
      // force-SOLD into the market → price overshot DOWN → bot goes LONG.
      // If shorts liquidated, force-BOUGHT into market → overshot UP → SHORT.
      const longLiqs = sumCascade(
        signals.liquidations,
        ctx.asset,
        "long",
        p.cascadeWindowMs,
      );
      const shortLiqs = sumCascade(
        signals.liquidations,
        ctx.asset,
        "short",
        p.cascadeWindowMs,
      );
      const dominantSide: "long" | "short" =
        longLiqs >= shortLiqs ? "long" : "short";
      const dominantNotional = Math.max(longLiqs, shortLiqs);
      if (dominantNotional < p.minCascadeNotionalUsd) return null;

      // Counter-direction: fade the forced flow.
      const ourSide: "long" | "short" =
        dominantSide === "long" ? "long" : "short";
      // Wait — that's the SAME direction. The forced LONGS got sold OFF
      // (they were closing longs by selling), so price went DOWN → we go
      // LONG. So if the liquidated side was "long", we also go long.
      // The mental model: liq side names the SIDE THAT GOT LIQUIDATED, and
      // we want to be on that same side after the wick prints.
      //
      // (Yes the variable name "ourSide" is a tautology of dominantSide
      // here; keeping the alias for readability in the decision below.)

      // Conviction scales with cascade size: $100M is floor, $500M is full.
      const sizeScore = Math.min(
        1,
        (dominantNotional - p.minCascadeNotionalUsd) / (4 * p.minCascadeNotionalUsd),
      );
      const conviction = clampConviction(0.4 + sizeScore * 0.6);
      const leverage = leverageFromConviction(p, conviction);

      return {
        asset: ctx.asset,
        side: ourSide,
        leverage,
        conviction,
        triggerMeta: {
          cascadeNotionalUsd: dominantNotional,
          liquidatedSide: dominantSide,
          windowMs: p.cascadeWindowMs,
          conviction,
          dynamicLeverage: leverage,
        },
      };
    },

    evaluateExit(ctx: MarketContext, position: PaperPosition): boolean {
      const heldMs = Date.now() - position.entryTs.getTime();
      if (heldMs >= p.maxHoldMs) return true;
      const moveFrac =
        (ctx.mark - position.entryMark) / position.entryMark;
      const favorable = position.side === "long" ? moveFrac : -moveFrac;
      return favorable >= p.exitFavorablePct;
    },
  };
}

export const VultureStrategy = createVultureStrategy({
  id: "vulture",
  cascadeWindowMs: 60 * 1000,
  minCascadeNotionalUsd: 100_000_000,
  exitFavorablePct: 0.008,
  maxHoldMs: 60 * 60 * 1000,
  leverage: 12,
  minLeverage: 8,
  maxLeverage: 20,
});

export const VultureBot: BotConfig = {
  id: "vulture",
  parentId: null,
  name: "Vulture",
  avatarEmoji: "🦅",
  personaVoiceKey: "vulture",
  strategyKey: "vulture",
  config: {
    cascadeWindowMs: 60 * 1000,
    minCascadeNotionalUsd: 100_000_000,
    exitFavorablePct: 0.008,
    maxHoldMs: 60 * 60 * 1000,
    leverage: 12,
    minLeverage: 8,
    maxLeverage: 20,
  },
  status: "paper",
};
