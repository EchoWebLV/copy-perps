// lib/bots/strategies/contrarian.ts
//
// Fades the consensus of the rest of the roster. If ≥3 paper bots are
// holding the same side of the same asset, the consensus is statistically
// a *contrarian* signal: the other bots have negative expected edge (we
// can see it in their PnL), so their pile-up is the time to take the
// opposite side.
//
// Edge source: the other bots' net-negative edge directly funds this one.
// The worse the other bots are doing on the consensus side, the better
// Contrarian does fading them.
//
// Octane: built-in narrative drama. The feed shows "4 of 6 bots are long
// BTC" and Contrarian is the only short — a five-way standoff.

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

interface ContrarianParams {
  id: string;
  minConsensusCount: number;      // ≥N bots on same side triggers contrarian
  exitFavorablePct: number;
  maxHoldMs: number;
  leverage: number;
  minLeverage?: number;
  maxLeverage?: number;
}

export function createContrarianStrategy(p: ContrarianParams): Strategy {
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
      if (!signals.crossBot) return null;
      const longCount =
        signals.crossBot.positionsByAssetSide.get(`${ctx.asset}|long`) ?? 0;
      const shortCount =
        signals.crossBot.positionsByAssetSide.get(`${ctx.asset}|short`) ?? 0;
      const dominantCount = Math.max(longCount, shortCount);
      if (dominantCount < p.minConsensusCount) return null;
      // Don't fire if both sides have similar counts — we want a real
      // imbalance, not 3v3.
      if (Math.abs(longCount - shortCount) < 2) return null;

      const consensusSide: "long" | "short" =
        longCount > shortCount ? "long" : "short";
      const ourSide: "long" | "short" =
        consensusSide === "long" ? "short" : "long";

      // Conviction grows with imbalance: 3v0 is mid, 5v0 or 6v1 is full.
      const imbalance = Math.abs(longCount - shortCount);
      const sizeScore = Math.min(1, (imbalance - 2) / 4);
      const conviction = clampConviction(0.4 + sizeScore * 0.6);
      const leverage = leverageFromConviction(p, conviction);

      return {
        asset: ctx.asset,
        side: ourSide,
        leverage,
        conviction,
        triggerMeta: {
          longCount,
          shortCount,
          consensusSide,
          imbalance,
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

export const ContrarianStrategy = createContrarianStrategy({
  id: "contrarian",
  minConsensusCount: 3,
  exitFavorablePct: 0.005,
  maxHoldMs: 60 * 60 * 1000,
  leverage: 8,
  minLeverage: 5,
  maxLeverage: 12,
});

export const ContrarianBot: BotConfig = {
  id: "contrarian",
  parentId: null,
  name: "Contrarian",
  avatarEmoji: "🪞",
  personaVoiceKey: "contrarian",
  strategyKey: "contrarian",
  config: {
    minConsensusCount: 3,
    exitFavorablePct: 0.005,
    maxHoldMs: 60 * 60 * 1000,
    leverage: 8,
    minLeverage: 5,
    maxLeverage: 12,
  },
  status: "paper",
};
