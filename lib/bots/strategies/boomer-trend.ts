// lib/bots/strategies/boomer-trend.ts
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

const ALLOWED_MARKETS = ["BTC", "ETH"] as const;

interface BoomerParams {
  id: string;
  timeframe: Timeframe;
  candleCount: number;
  fastPeriod: number;
  slowPeriod: number;
  exitFavorablePct: number;
  maxHoldMs: number;
  leverage: number;
  regimesAllowed: Regime[];
}

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  result.push(values[0]);
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

export function createBoomerTrendStrategy(p: BoomerParams): Strategy {
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
      if (candles.length < p.slowPeriod + 2) return null;
      const closes = candles.map((c) => c.close);
      const fast = ema(closes, p.fastPeriod);
      const slow = ema(closes, p.slowPeriod);
      const lastFast = fast[fast.length - 1];
      const lastSlow = slow[slow.length - 1];
      // Look for the most recent crossover within the last 5 candles
      let crossedUp = false;
      let crossedDown = false;
      const scanStart = Math.max(1, fast.length - 5);
      for (let i = scanStart; i < fast.length; i++) {
        const pf = fast[i - 1];
        const ps = slow[i - 1];
        const lf = fast[i];
        const ls = slow[i];
        if (pf <= ps && lf > ls) { crossedUp = true; break; }
        if (pf >= ps && lf < ls) { crossedDown = true; break; }
      }
      if (!crossedUp && !crossedDown) return null;
      const side: "long" | "short" = crossedUp ? "long" : "short";
      const lastDiff = lastFast - lastSlow;
      const lastClose = candles[candles.length - 1].close;
      const crossStrength = Math.abs(lastDiff) / Math.max(lastClose, 1);
      const conviction = clampConviction(crossStrength * 100); // typical lastDiff is 0..1% of price
      return {
        asset: ctx.asset,
        side,
        leverage: p.leverage,
        conviction,
        triggerMeta: {
          fastEma: lastFast,
          slowEma: lastSlow,
          crossedUp,
          crossedDown,
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

export const BoomerTrendStrategy = createBoomerTrendStrategy({
  id: "boomer-trend",
  timeframe: "4h",
  candleCount: 30,
  fastPeriod: 7,
  slowPeriod: 21,
  exitFavorablePct: 0.03,
  maxHoldMs: 48 * 60 * 60 * 1000,
  leverage: 10,
  regimesAllowed: ["trending-up", "trending-down"],
});

export const BoomerTrendWideStrategy = createBoomerTrendStrategy({
  id: "boomer-trend-wide",
  timeframe: "4h",
  candleCount: 40,
  fastPeriod: 12,
  slowPeriod: 36,
  exitFavorablePct: 0.05,
  maxHoldMs: 72 * 60 * 60 * 1000,
  leverage: 10,
  regimesAllowed: ["trending-up", "trending-down", "mean-reverting"],
});

export const BoomerTrendBot: BotConfig = {
  id: "boomer-trend",
  parentId: null,
  name: "Boomer Trend",
  avatarEmoji: "🐢",
  personaVoiceKey: "boomer-trend",
  strategyKey: "boomer-trend",
  config: {
    timeframe: "4h",
    candleCount: 30,
    fastPeriod: 7,
    slowPeriod: 21,
    exitFavorablePct: 0.03,
    maxHoldMs: 48 * 60 * 60 * 1000,
    leverage: 10,
    regimesAllowed: ["trending-up", "trending-down"],
  },
  status: "paper",
};

export const BoomerTrendWideBot: BotConfig = {
  id: "boomer-trend-wide",
  parentId: "boomer-trend",
  name: "Boomer Trend Wide",
  avatarEmoji: "🐢",
  personaVoiceKey: "boomer-trend",
  strategyKey: "boomer-trend-wide",
  config: {
    timeframe: "4h",
    candleCount: 40,
    fastPeriod: 12,
    slowPeriod: 36,
    exitFavorablePct: 0.05,
    maxHoldMs: 72 * 60 * 60 * 1000,
    leverage: 10,
    regimesAllowed: ["trending-up", "trending-down", "mean-reverting"],
  },
  status: "paper",
};
