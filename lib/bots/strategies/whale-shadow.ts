// lib/bots/strategies/whale-shadow.ts
//
// Copies entries from a curated set of high-PnL Hyperliquid wallets in
// near-real-time. When any tracked whale opens a position ≥ $500k
// notional on BTC/ETH/SOL, the bot mirrors the side and asset.
//
// Edge source: information asymmetry + sticky-handed alpha. These
// wallets are filtered to directional traders with positive 7d/30d PnL.
// When they open, they typically hold for hours-to-days, so we inherit
// their entry and let the position run on a multi-hour timeframe.
// Friction is < 0.3% of stake at 8× over 2 hours — well below their
// expected per-trade edge.
//
// Octane: dramatic single-trade openings narrated as a follow — "Whale
// 0x6f... just opened 8× ETH long with $1.2M notional. Shadow opened
// beside them at $3,841."

import type {
  BotConfig,
  EntryDecision,
  ExternalSignals,
  MarketContext,
  PaperPosition,
  Strategy,
  WhaleOpenEvent,
} from "../types";
import { clampConviction } from "../types";
import { leverageFromConviction } from "../leverage";

const ALLOWED_MARKETS = ["BTC", "ETH", "SOL"] as const;

interface WhaleShadowParams {
  id: string;
  minNotionalUsd: number;     // floor for which whales we copy
  freshnessMs: number;        // only copy fills within this age
  exitFavorablePct: number;
  exitAdverseStopPct: number; // negative-PnL fraction that triggers exit
  maxHoldMs: number;
  leverage: number;
  minLeverage?: number;
  maxLeverage?: number;
}

function pickMostRecentWhaleOpen(
  opens: WhaleOpenEvent[],
  asset: string,
  minNotional: number,
  freshnessMs: number,
): WhaleOpenEvent | null {
  const cutoff = Date.now() - freshnessMs;
  let best: WhaleOpenEvent | null = null;
  for (const o of opens) {
    if (o.asset !== asset) continue;
    if (o.notionalUsd < minNotional) continue;
    if (o.ts < cutoff) continue;
    if (!best || o.ts > best.ts) best = o;
  }
  return best;
}

export function createWhaleShadowStrategy(
  p: WhaleShadowParams,
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
      if (!signals.whaleOpens) return null;
      const whaleOpen = pickMostRecentWhaleOpen(
        signals.whaleOpens,
        ctx.asset,
        p.minNotionalUsd,
        p.freshnessMs,
      );
      if (!whaleOpen) return null;

      // Conviction grows with whale notional. $500k = 0.3, $5M = 1.0.
      const sizeScore = Math.min(
        1,
        (whaleOpen.notionalUsd - p.minNotionalUsd) / (9 * p.minNotionalUsd),
      );
      const conviction = clampConviction(0.3 + sizeScore * 0.7);
      const leverage = leverageFromConviction(p, conviction);

      return {
        asset: ctx.asset,
        side: whaleOpen.side,
        leverage,
        conviction,
        triggerMeta: {
          whaleAddress: whaleOpen.whaleAddress,
          whaleNotionalUsd: whaleOpen.notionalUsd,
          whaleEntryPx: whaleOpen.px,
          whaleOpenedAt: whaleOpen.ts,
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
      if (favorable >= p.exitFavorablePct) return true;
      if (favorable <= -p.exitAdverseStopPct) return true;
      return false;
    },
  };
}

export const WhaleShadowStrategy = createWhaleShadowStrategy({
  id: "whale-shadow",
  minNotionalUsd: 500_000,
  freshnessMs: 4 * 60 * 1000,
  exitFavorablePct: 0.012,
  exitAdverseStopPct: 0.008,
  maxHoldMs: 4 * 60 * 60 * 1000,
  leverage: 10,
  minLeverage: 5,
  maxLeverage: 15,
});

export const WhaleShadowBot: BotConfig = {
  id: "whale-shadow",
  parentId: null,
  name: "Shadow",
  avatarEmoji: "🐋",
  personaVoiceKey: "whale-shadow",
  strategyKey: "whale-shadow",
  config: {
    minNotionalUsd: 500_000,
    freshnessMs: 4 * 60 * 1000,
    exitFavorablePct: 0.012,
    exitAdverseStopPct: 0.008,
    maxHoldMs: 4 * 60 * 60 * 1000,
    leverage: 10,
    minLeverage: 5,
    maxLeverage: 15,
  },
  status: "paper",
};
