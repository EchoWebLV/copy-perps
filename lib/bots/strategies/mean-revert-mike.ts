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

const ALLOWED_MARKETS = ["SOL", "HYPE", "AVAX", "DOGE", "XRP"] as const;

interface MikeParams {
  id: string;
  timeframe: Timeframe;
  candleCount: number;
  zEntryThreshold: number;
  exitFavorablePct: number;
  maxHoldMs: number;
  leverage: number;
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
      // Regime gate: skip if classifier says we're in a regime the strategy
      // doesn't trade in. Fail-OPEN — null regime means classifier had no read,
      // fire normally.
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
      const conviction = clampConviction((Math.abs(z) - 2.5) / 1.5);
      return {
        asset: ctx.asset,
        side,
        leverage: p.leverage,
        conviction,
        triggerMeta: { zScore: z, threshold: p.zEntryThreshold },
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

export const MeanRevertMikeStrategy = createMeanRevertMikeStrategy({
  id: "mean-revert-mike",
  timeframe: "1m",
  candleCount: 30,
  zEntryThreshold: 2.5,
  exitFavorablePct: 0.006,
  maxHoldMs: 30 * 60 * 1000,
  leverage: 25,
  regimesAllowed: ["mean-reverting", "chop"],
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
  name: "Mean-Revert Mike",
  avatarEmoji: "🎯",
  personaVoiceKey: "mean-revert-mike",
  strategyKey: "mean-revert-mike",
  config: {
    timeframe: "1m",
    candleCount: 30,
    zEntryThreshold: 2.5,
    exitFavorablePct: 0.006,
    maxHoldMs: 30 * 60 * 1000,
    leverage: 25,
    regimesAllowed: ["mean-reverting", "chop"],
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
