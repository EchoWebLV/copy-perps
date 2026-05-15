// lib/bots/strategies/scalper.ts
//
// Long-only, single-asset, max-leverage scalper. Designed as a
// high-octane test bot — always wants to be long its target asset
// (gold, sp500, etc.), opens at max leverage, exits on a small
// favorable move OR a tight stop. Cooldown after every close to keep
// the fee bleed manageable.
//
// Caveat: at 80% of bankroll × 5-10x leverage, friction alone is
// ~0.4% of stake per round-trip. The bot needs ~65-70% win rate just
// to break even. These bots are expected to either rocket or bust —
// they are the "max degen" archetype in the roster.

import type {
  BotConfig,
  EntryDecision,
  ExternalSignals,
  MarketContext,
  PaperPosition,
  Strategy,
} from "../types";
import { clampConviction } from "../types";

export interface ScalperParams {
  id: string;
  asset: string;         // single target asset, e.g. "XAU"
  side: "long" | "short"; // direction bias — bullion/atlas are long-only
  maxLeverage: number;   // the bot's preferred lev; resolver will clamp
                         // again against Pacifica's per-market cap
  tpPricePct: number;    // take profit when price moves this fraction in our favor
  slPricePct: number;    // stop loss when price moves this fraction against us
  maxHoldMs: number;     // force-close after this regardless of TP/SL
  cooldownAfterCloseMs: number; // wait this long before opening again
}

// Per-strategy "last close" timestamp so we can enforce the post-close
// cooldown. In-memory; resets across dev-server restarts but the next
// tick after a restart just re-checks via fetchOpenPositionsForBot.
const _lastCloseAt = new Map<string, number>();

export function noteScalperCloseAt(id: string, ms: number): void {
  _lastCloseAt.set(id, ms);
}

export function createScalperStrategy(p: ScalperParams): Strategy {
  return {
    id: p.id,
    // Only scan its target market — keeps the resolver loop tight and
    // ensures `openAssets.has(...)` correctly blocks double-opens.
    markets: [p.asset],

    evaluateEntry(
      ctx: MarketContext,
      _signals: ExternalSignals,
    ): EntryDecision | null {
      if (ctx.asset !== p.asset) return null;
      const since = _lastCloseAt.get(p.id) ?? 0;
      if (Date.now() - since < p.cooldownAfterCloseMs) return null;
      return {
        asset: p.asset,
        side: p.side,
        leverage: p.maxLeverage,
        // Conviction at floor — the actual sizing is driven by
        // bot.config.stakePctOverride, not by conviction × MAX_STAKE_PCT.
        conviction: clampConviction(1.0),
        triggerMeta: {
          strategy: "scalper",
          targetAsset: p.asset,
          side: p.side,
          tpPricePct: p.tpPricePct,
          slPricePct: p.slPricePct,
          dynamicLeverage: p.maxLeverage,
          conviction: 1.0,
        },
      };
    },

    evaluateExit(
      ctx: MarketContext,
      position: PaperPosition,
    ): boolean {
      const heldMs = Date.now() - position.entryTs.getTime();
      if (heldMs >= p.maxHoldMs) {
        _lastCloseAt.set(p.id, Date.now());
        return true;
      }
      const moveFrac =
        (ctx.mark - position.entryMark) / position.entryMark;
      const favorable = position.side === "long" ? moveFrac : -moveFrac;
      if (favorable >= p.tpPricePct) {
        _lastCloseAt.set(p.id, Date.now());
        return true;
      }
      if (favorable <= -p.slPricePct) {
        _lastCloseAt.set(p.id, Date.now());
        return true;
      }
      return false;
    },
  };
}

/** Helper used by the bot files to wire up a scalper bot with one call. */
export function buildScalperBot(args: {
  id: string;
  name: string;
  avatarEmoji: string;
  personaVoiceKey: string;
  asset: string;
  side: "long" | "short";
  maxLeverage: number;
  stakePctOverride: number;
  tpPricePct: number;
  slPricePct: number;
  maxHoldMs?: number;
  cooldownAfterCloseMs?: number;
}): { bot: BotConfig; strategy: Strategy } {
  const strategy = createScalperStrategy({
    id: args.id,
    asset: args.asset,
    side: args.side,
    maxLeverage: args.maxLeverage,
    tpPricePct: args.tpPricePct,
    slPricePct: args.slPricePct,
    maxHoldMs: args.maxHoldMs ?? 60 * 60 * 1000,
    cooldownAfterCloseMs: args.cooldownAfterCloseMs ?? 5 * 60 * 1000,
  });
  const bot: BotConfig = {
    id: args.id,
    parentId: null,
    name: args.name,
    avatarEmoji: args.avatarEmoji,
    personaVoiceKey: args.personaVoiceKey,
    strategyKey: args.id,
    config: {
      asset: args.asset,
      side: args.side,
      maxLeverage: args.maxLeverage,
      stakePctOverride: args.stakePctOverride,
      tpPricePct: args.tpPricePct,
      slPricePct: args.slPricePct,
      maxHoldMs: args.maxHoldMs ?? 60 * 60 * 1000,
      cooldownAfterCloseMs: args.cooldownAfterCloseMs ?? 5 * 60 * 1000,
      // Per-bot loosened stop-loss because the scalper handles its own
      // SL in evaluateExit. Without this the resolver's default 50%
      // stake-pnl stop would interfere with the tighter price-based stop.
      stopLossPct: 0.9,
    },
    status: "paper",
  };
  return { bot, strategy };
}
