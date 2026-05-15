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
import { leverageFromConviction } from "../leverage";

const ALLOWED_MARKETS = ["BTC", "ETH", "SOL"] as const;

interface MomoParams {
  id: string;
  timeframe: Timeframe;
  candleCount: number;
  breakoutPct: number;
  volumeMultiplier: number;
  exitFavorablePct: number;
  maxHoldMs: number;
  leverage: number;
  minLeverage?: number;
  maxLeverage?: number;
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
      // Conviction blends two signal-strength axes: how big the breakout
      // is relative to the trigger threshold, and how loud the volume is
      // relative to baseline. Both contribute equally.
      const breakoutScore = Math.min(1, Math.abs(moveFrac) / (p.breakoutPct * 2));
      const volumeScore = Math.min(1, (volRatio - 1) / 2);
      const conviction = clampConviction((breakoutScore + volumeScore) / 2);
      const leverage = leverageFromConviction(p, conviction);
      return {
        asset: ctx.asset,
        side,
        leverage,
        conviction,
        triggerMeta: {
          breakoutPct: moveFrac,
          volumeRatio: volRatio,
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

// Surge — alpha-arena bot. Smarter v2: BTC/ETH/SOL only (no thin-alt
// slippage tax), stricter triggers (0.3% breakout on 1.2x volume), and
// dynamic leverage 6-18x scaled by signal strength. Round-trip friction
// at 6x on BTC is ~0.9% of stake → marginal trades stop bleeding fees.
export const MomoMaxAggressiveStrategy = createMomoMaxStrategy({
  id: "momo-max-aggressive",
  timeframe: "1m",
  candleCount: 6,
  breakoutPct: 0.003,
  volumeMultiplier: 1.2,
  exitFavorablePct: 0.003,
  maxHoldMs: 5 * 60 * 1000,
  leverage: 12,
  minLeverage: 6,
  maxLeverage: 18,
  regimesAllowed: [],
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
  parentId: null,
  name: "Surge",
  avatarEmoji: "🚀",
  personaVoiceKey: "momo-max",
  strategyKey: "momo-max-aggressive",
  config: {
    timeframe: "1m",
    candleCount: 6,
    breakoutPct: 0.003,
    volumeMultiplier: 1.2,
    exitFavorablePct: 0.003,
    maxHoldMs: 5 * 60 * 1000,
    leverage: 12,
    minLeverage: 6,
    maxLeverage: 18,
    regimesAllowed: [],
  },
  status: "paper",
};
