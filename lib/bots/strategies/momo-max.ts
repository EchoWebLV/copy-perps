// lib/bots/strategies/momo-max.ts
import { getCandles, type Timeframe } from "@/lib/data/candles";
import type {
  BotConfig,
  EntryDecision,
  ExternalSignals,
  MarketContext,
  PaperPosition,
  Strategy,
} from "../types";
import { clampConviction } from "../types";
import { getRegime, type Regime } from "../regime";

const ALLOWED_MARKETS = ["BTC", "ETH", "SOL", "HYPE"] as const;

interface MomoParams {
  id: string;
  timeframe: Timeframe;
  candleCount: number;
  breakoutPct: number;
  volumeMultiplier: number;
  exitFavorablePct: number;
  maxHoldMs: number;
  leverage: number;
  regimesAllowed: Regime[];
}

export function createMomoMaxStrategy(p: MomoParams): Strategy {
  return {
    id: p.id,
    markets: ALLOWED_MARKETS,

    async evaluateEntry(
      ctx: MarketContext,
      _signals: ExternalSignals,
    ): Promise<EntryDecision | null> {
      if (
        !ALLOWED_MARKETS.includes(
          ctx.asset as (typeof ALLOWED_MARKETS)[number],
        )
      ) {
        return null;
      }
      // Regime gate: skip if classifier says we're in a regime the strategy
      // doesn't trade in. Fail-OPEN — null regime means classifier had no read,
      // fire normally.
      if (p.regimesAllowed.length > 0) {
        const regime = await getRegime(ctx.asset);
        if (regime && !p.regimesAllowed.includes(regime.regime)) return null;
      }
      const candles = await getCandles(ctx.asset, p.timeframe, p.candleCount);
      if (candles.length < p.candleCount) return null;
      const last = candles[candles.length - 1];
      const priorVolumes = candles
        .slice(0, candles.length - 1)
        .map((c) => c.volume);
      const meanPriorVolume =
        priorVolumes.reduce((s, v) => s + v, 0) / priorVolumes.length;
      if (meanPriorVolume === 0) return null;
      if (last.volume / meanPriorVolume < p.volumeMultiplier) return null;
      const moveFrac = (last.close - last.open) / last.open;
      if (Math.abs(moveFrac) < p.breakoutPct) return null;
      const side: "long" | "short" = moveFrac > 0 ? "long" : "short";
      const volRatio = last.volume / meanPriorVolume;
      const conviction = clampConviction(volRatio / 3);
      return {
        asset: ctx.asset,
        side,
        leverage: p.leverage,
        conviction,
        triggerMeta: {
          breakoutPct: moveFrac,
          volumeRatio: volRatio,
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

export const MomoMaxStrategy = createMomoMaxStrategy({
  id: "momo-max",
  timeframe: "5m",
  candleCount: 12,
  breakoutPct: 0.01,
  volumeMultiplier: 1.5,
  exitFavorablePct: 0.005,
  maxHoldMs: 30 * 60 * 1000,
  leverage: 30,
  regimesAllowed: ["trending-up", "trending-down", "vol-expanding"],
});

export const MomoMaxAggressiveStrategy = createMomoMaxStrategy({
  id: "momo-max-aggressive",
  timeframe: "5m",
  candleCount: 12,
  breakoutPct: 0.005,
  volumeMultiplier: 1.3,
  exitFavorablePct: 0.003,
  maxHoldMs: 20 * 60 * 1000,
  leverage: 50,
  regimesAllowed: ["trending-up", "trending-down", "vol-expanding", "chop"],
});

export const MomoMaxBot: BotConfig = {
  id: "momo-max",
  parentId: null,
  name: "Momo Max",
  avatarEmoji: "🚀",
  personaVoiceKey: "momo-max",
  strategyKey: "momo-max",
  config: {
    timeframe: "5m",
    candleCount: 12,
    breakoutPct: 0.01,
    volumeMultiplier: 1.5,
    exitFavorablePct: 0.005,
    maxHoldMs: 30 * 60 * 1000,
    leverage: 30,
    regimesAllowed: ["trending-up", "trending-down", "vol-expanding"],
  },
  status: "paper",
};

export const MomoMaxAggressiveBot: BotConfig = {
  id: "momo-max-aggressive",
  parentId: "momo-max",
  name: "Momo Max Aggressive",
  avatarEmoji: "🚀",
  personaVoiceKey: "momo-max",
  strategyKey: "momo-max-aggressive",
  config: {
    timeframe: "5m",
    candleCount: 12,
    breakoutPct: 0.005,
    volumeMultiplier: 1.3,
    exitFavorablePct: 0.003,
    maxHoldMs: 20 * 60 * 1000,
    leverage: 50,
    regimesAllowed: ["trending-up", "trending-down", "vol-expanding", "chop"],
  },
  status: "paper",
};
