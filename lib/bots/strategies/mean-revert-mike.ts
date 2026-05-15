// lib/bots/strategies/mean-revert-mike.ts
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

interface MikeParams {
  id: string;
  timeframe: Timeframe;
  candleCount: number;
  zEntryThreshold: number;
  exitFavorablePct: number;
  maxHoldMs: number;
  leverage: number;
  minLeverage?: number;
  maxLeverage?: number;
  regimesAllowed: Regime[];
}

function zScore(values: number[], current: number): number | null {
  if (values.length < 2) return null;
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance =
    values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1);
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return null;
  return (current - mean) / stddev;
}

export function createMeanRevertMikeStrategy(p: MikeParams): Strategy {
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
      if (candles.length < Math.floor(p.candleCount * 0.5)) return null;
      const closes = candles.map((c) => c.close);
      const z = zScore(closes, ctx.mark);
      if (z === null) return null;
      if (Math.abs(z) < p.zEntryThreshold) return null;
      const side: "long" | "short" = z > 0 ? "short" : "long";
      // Conviction scales how far past the threshold we are. At
      // threshold = 0.0 conviction (clamped to 0.3 floor); 1.5σ past it
      // = 1.0 conviction. Bigger stretch = juicier mean-revert bet =
      // bigger leverage.
      const overshoot = Math.abs(z) - p.zEntryThreshold;
      const conviction = clampConviction(overshoot / 1.5);
      const leverage = leverageFromConviction(p, conviction);
      // Plain-English number for narrations: percentage deviation from
      // the rolling mean. The narrator quotes this instead of z-score
      // so the thesis reads like English, not a stats lecture.
      const meanPrice = closes.reduce((s, v) => s + v, 0) / closes.length;
      const pctFromMean = meanPrice > 0 ? (ctx.mark - meanPrice) / meanPrice : 0;
      return {
        asset: ctx.asset,
        side,
        leverage,
        conviction,
        triggerMeta: {
          zScore: z,
          threshold: p.zEntryThreshold,
          pctFromMean,
          meanPrice,
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

// Fade — alpha-arena bot. Smarter v2: BTC/ETH/SOL only, z-threshold
// raised 1.2 → 2.0 (fades real stretches, not noise), dynamic leverage
// 5-15x scaled by overshoot. Tighter triggers cut trade frequency ~half
// so fewer mean-revert-eats-trend disasters.
export const MeanRevertMikeStrategy = createMeanRevertMikeStrategy({
  id: "mean-revert-mike",
  timeframe: "1m",
  candleCount: 20,
  zEntryThreshold: 2.0,
  exitFavorablePct: 0.003,
  maxHoldMs: 10 * 60 * 1000,
  leverage: 10,
  minLeverage: 5,
  maxLeverage: 15,
  regimesAllowed: [],
});

export const MeanRevertMikePatientStrategy = createMeanRevertMikeStrategy({
  id: "mean-revert-mike-patient",
  timeframe: "1h",
  candleCount: 24,
  zEntryThreshold: 3.0,
  exitFavorablePct: 0.012,
  maxHoldMs: 4 * 60 * 60 * 1000,
  leverage: 5,
  regimesAllowed: ["mean-reverting"],
});

export const MeanRevertMikeBot: BotConfig = {
  id: "mean-revert-mike",
  parentId: null,
  name: "Fade",
  avatarEmoji: "🎯",
  personaVoiceKey: "mean-revert-mike",
  strategyKey: "mean-revert-mike",
  config: {
    timeframe: "1m",
    candleCount: 20,
    zEntryThreshold: 2.0,
    exitFavorablePct: 0.003,
    maxHoldMs: 10 * 60 * 1000,
    leverage: 10,
    minLeverage: 5,
    maxLeverage: 15,
    regimesAllowed: [],
  },
  status: "paper",
};

export const MeanRevertMikePatientBot: BotConfig = {
  id: "mean-revert-mike-patient",
  parentId: "mean-revert-mike",
  name: "Mean-Revert Mike Patient",
  avatarEmoji: "🎯",
  personaVoiceKey: "mean-revert-mike",
  strategyKey: "mean-revert-mike-patient",
  config: {
    timeframe: "1h",
    candleCount: 24,
    zEntryThreshold: 3.0,
    exitFavorablePct: 0.012,
    maxHoldMs: 4 * 60 * 60 * 1000,
    leverage: 5,
    regimesAllowed: ["mean-reverting"],
  },
  status: "paper",
};
