// lib/bots/strategies/tilt.ts
//
// TILT — the degenerate revenge trader. A momentum chaser wrapped in a
// martingale. Each tick it chases whatever crypto just moved hardest
// and trades that direction; the degenerate part is the sizing.
//
// Tilt reads its own recent closed trades and DOUBLES its leverage on
// every consecutive loss — 10x -> 20x -> 40x -> 50x (cap) — snapping
// back to the 10x base the instant it books a win. Stake stays fat
// (60% of bankroll, via stakePctOverride). It snatches small wins fast
// and rides losers almost to liquidation (stopLossPct 0.9).
//
// The classic degen arc: grind, tilt, double down, detonate — then
// maybe claw it all back. Built to be watched, not to win.

import { getCandles } from "@/lib/data/candles";
import { getLossStreak } from "../paper";
import type {
  BotConfig,
  EntryDecision,
  ExternalSignals,
  MarketContext,
  PaperPosition,
  Strategy,
} from "../types";

const ALLOWED_MARKETS = ["BTC", "ETH", "SOL"] as const;

const TIMEFRAME = "5m" as const;
const CANDLE_COUNT = 6; // last ~30 min
const MIN_PUSH = 0.003; // chase any >=0.3% net move

const BASE_LEVERAGE = 10;
const MAX_LEVERAGE = 50;

const TAKE_PROFIT_PCT = 0.006; // snatch a small win, reset the streak
const MAX_HOLD_MS = 45 * 60 * 1000; // impatient

export const TiltStrategy: Strategy = {
  id: "tilt",
  markets: ALLOWED_MARKETS,

  async evaluateEntry(
    ctx: MarketContext,
    _signals: ExternalSignals,
  ): Promise<EntryDecision | null> {
    if (
      !ALLOWED_MARKETS.includes(ctx.asset as (typeof ALLOWED_MARKETS)[number])
    ) {
      return null;
    }

    // Signal: chase the recent push.
    const candles = await getCandles(ctx.asset, TIMEFRAME, CANDLE_COUNT);
    if (candles.length < 3) return null;
    const first = candles[0].close;
    const last = candles[candles.length - 1].close;
    if (!Number.isFinite(first) || first <= 0) return null;
    const move = (last - first) / first;
    if (Math.abs(move) < MIN_PUSH) return null;
    const side: "long" | "short" = move > 0 ? "long" : "short";

    // The degenerate part: martingale the leverage on the loss streak.
    const lossStreak = await getLossStreak("tilt");
    const leverage = Math.min(MAX_LEVERAGE, BASE_LEVERAGE * 2 ** lossStreak);

    return {
      asset: ctx.asset,
      side,
      leverage,
      conviction: 1,
      triggerMeta: {
        strategy: "tilt",
        recentMovePct: move,
        lossStreak,
        dynamicLeverage: leverage,
        conviction: 1,
      },
    };
  },

  evaluateExit(ctx: MarketContext, position: PaperPosition): boolean {
    const heldMs = Date.now() - position.entryTs.getTime();
    if (heldMs >= MAX_HOLD_MS) return true;
    const moveFrac = (ctx.mark - position.entryMark) / position.entryMark;
    const favorable = position.side === "long" ? moveFrac : -moveFrac;
    // Snatch the win fast. The downside is left to the resolver's
    // stop-loss (stopLossPct 0.9 — Tilt rides losers to the brink).
    return favorable >= TAKE_PROFIT_PCT;
  },
};

export const TiltBot: BotConfig = {
  id: "tilt",
  parentId: null,
  name: "Tilt",
  avatarEmoji: "🎰",
  personaVoiceKey: "tilt",
  strategyKey: "tilt",
  config: {
    stakePctOverride: 0.6,
    stopLossPct: 0.9,
  },
  status: "paper",
};
