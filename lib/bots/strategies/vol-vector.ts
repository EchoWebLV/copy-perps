// lib/bots/strategies/vol-vector.ts
import { getCandles, type Timeframe } from "@/lib/data/candles";
import type {
  BotConfig,
  EntryDecision,
  ExternalSignals,
  MarketContext,
  PaperPosition,
  Strategy,
} from "../types";

const ALLOWED_MARKETS = ["BTC", "ETH", "SOL", "HYPE", "XRP", "AVAX"] as const;

interface VolParams {
  id: string;
  recentTimeframe: Timeframe;
  recentCount: number;
  baselineTimeframe: Timeframe;
  baselineCount: number;
  volMultiplier: number;
  trendConsistencyMin: number;
  exitFavorablePct: number;
  maxHoldMs: number;
  leverage: number;
}

function realizedVol(candles: { close: number }[]): number {
  if (candles.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const next = candles[i].close;
    if (prev === 0) continue;
    returns.push((next - prev) / prev);
  }
  if (returns.length === 0) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) * (r - mean), 0) / returns.length;
  return Math.sqrt(variance);
}

export function createVolVectorStrategy(p: VolParams): Strategy {
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
      const [recent, baseline] = await Promise.all([
        getCandles(ctx.asset, p.recentTimeframe, p.recentCount),
        getCandles(ctx.asset, p.baselineTimeframe, p.baselineCount),
      ]);
      if (recent.length < 2 || baseline.length < 2) return null;
      const recentVol = realizedVol(recent);
      const baseVol = realizedVol(baseline);
      // If baseVol is zero but recentVol is non-zero, the spike ratio is infinite —
      // treat that as exceeding any threshold. If both are zero, no spike.
      if (baseVol === 0) {
        if (recentVol === 0) return null;
      } else if (recentVol / baseVol < p.volMultiplier) {
        return null;
      }
      let up = 0;
      let down = 0;
      for (const c of recent) {
        if (c.close > c.open) up += 1;
        else if (c.close < c.open) down += 1;
      }
      const total = up + down;
      if (total === 0) return null;
      const upFrac = up / total;
      const downFrac = down / total;
      if (upFrac < p.trendConsistencyMin && downFrac < p.trendConsistencyMin)
        return null;
      const side: "long" | "short" = upFrac > downFrac ? "long" : "short";
      return {
        asset: ctx.asset,
        side,
        leverage: p.leverage,
        triggerMeta: {
          recentVol,
          baseVol,
          ratio: recentVol / baseVol,
          upFrac,
          downFrac,
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

export const VolVectorStrategy = createVolVectorStrategy({
  id: "vol-vector",
  recentTimeframe: "1m",
  recentCount: 5,
  baselineTimeframe: "1h",
  baselineCount: 24,
  volMultiplier: 1.5,
  trendConsistencyMin: 0.6,
  exitFavorablePct: 0.006,
  maxHoldMs: 15 * 60 * 1000,
  leverage: 30,
});

export const VolVectorHairTriggerStrategy = createVolVectorStrategy({
  id: "vol-vector-hair-trigger",
  recentTimeframe: "1m",
  recentCount: 5,
  baselineTimeframe: "1h",
  baselineCount: 24,
  volMultiplier: 1.2,
  trendConsistencyMin: 0.5,
  exitFavorablePct: 0.004,
  maxHoldMs: 10 * 60 * 1000,
  leverage: 30,
});

export const VolVectorBot: BotConfig = {
  id: "vol-vector",
  parentId: null,
  name: "Vol Vector",
  avatarEmoji: "💥",
  personaVoiceKey: "vol-vector",
  strategyKey: "vol-vector",
  config: {
    recentTimeframe: "1m",
    recentCount: 5,
    baselineTimeframe: "1h",
    baselineCount: 24,
    volMultiplier: 1.5,
    trendConsistencyMin: 0.6,
    exitFavorablePct: 0.006,
    maxHoldMs: 15 * 60 * 1000,
    leverage: 30,
  },
  status: "paper",
};

export const VolVectorHairTriggerBot: BotConfig = {
  id: "vol-vector-hair-trigger",
  parentId: "vol-vector",
  name: "Vol Vector Hair-Trigger",
  avatarEmoji: "💥",
  personaVoiceKey: "vol-vector",
  strategyKey: "vol-vector-hair-trigger",
  config: {
    recentTimeframe: "1m",
    recentCount: 5,
    baselineTimeframe: "1h",
    baselineCount: 24,
    volMultiplier: 1.2,
    trendConsistencyMin: 0.5,
    exitFavorablePct: 0.004,
    maxHoldMs: 10 * 60 * 1000,
    leverage: 30,
  },
  status: "paper",
};
