// lib/bots/strategies/funding-sniper.ts
//
// Fades extreme funding-rate positioning. When the cross-CEX average
// 8h funding rate for an asset hits ±0.5% (annualized 550%+), longs (or
// shorts) are paying so much to hold that the trade is over-crowded.
// Mean reversion is near-certain on a 1-4h horizon AND the bot collects
// the funding payment while it waits.
//
// Edge source: structural. Funding extremes literally pay you to be
// contrarian. Even if the price doesn't move, the bot earns the funding
// drip. Win-win unless funding flips and reverses fast.
//
// Octane: rare but loud — fires only when funding crosses an extreme
// threshold AND ≥3 of 4 venues agree on direction.

import type {
  BotConfig,
  EntryDecision,
  ExternalSignals,
  MarketContext,
  PaperPosition,
  Strategy,
} from "../types";
import { clampConviction } from "../types";
import { leverageFromConviction } from "../leverage";

const ALLOWED_MARKETS = ["BTC", "ETH", "SOL"] as const;

interface FundingSniperParams {
  id: string;
  fundingExtremeThreshold: number; // e.g. 0.005 = 0.5% per 8h
  minVenueAgreement: number;       // ≥N venues must agree on direction
  exitFavorablePct: number;
  maxHoldMs: number;
  leverage: number;
  minLeverage?: number;
  maxLeverage?: number;
}

export function createFundingSniperStrategy(
  p: FundingSniperParams,
): Strategy {
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
      const f = signals.funding[ctx.asset];
      if (!f) return null;
      if (f.venuesAgreed < p.minVenueAgreement) return null;
      const absRate = Math.abs(f.avgRate);
      if (absRate < p.fundingExtremeThreshold) return null;

      // Positive funding → longs paying → trade is too-long → SHORT
      // Negative funding → shorts paying → trade is too-short → LONG
      const side: "long" | "short" = f.avgRate > 0 ? "short" : "long";

      // Conviction grows linearly past the threshold. At threshold = 0.3
      // (clamped floor). At 2× threshold = 1.0 (max leverage).
      const overshoot = (absRate - p.fundingExtremeThreshold) / p.fundingExtremeThreshold;
      const conviction = clampConviction(0.3 + Math.min(1, overshoot) * 0.7);
      const leverage = leverageFromConviction(p, conviction);

      // Annualized rate for plain-English thesis (3 funding periods/day = 1095 periods/yr)
      const annualizedPct = absRate * 1095 * 100;

      return {
        asset: ctx.asset,
        side,
        leverage,
        conviction,
        triggerMeta: {
          fundingRate: f.avgRate,
          fundingAbs: absRate,
          venuesAgreed: f.venuesAgreed,
          venuesQueried: f.venuesQueried,
          annualizedPct,
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

export const FundingSniperStrategy = createFundingSniperStrategy({
  id: "funding-sniper",
  fundingExtremeThreshold: 0.005,
  minVenueAgreement: 3,
  exitFavorablePct: 0.005,
  maxHoldMs: 4 * 60 * 60 * 1000,
  leverage: 8,
  minLeverage: 4,
  maxLeverage: 12,
});

export const FundingSniperBot: BotConfig = {
  id: "funding-sniper",
  parentId: null,
  name: "Sniper",
  avatarEmoji: "🎯",
  personaVoiceKey: "funding-sniper",
  strategyKey: "funding-sniper",
  config: {
    fundingExtremeThreshold: 0.005,
    minVenueAgreement: 3,
    exitFavorablePct: 0.005,
    maxHoldMs: 4 * 60 * 60 * 1000,
    leverage: 8,
    minLeverage: 4,
    maxLeverage: 12,
  },
  status: "paper",
};
