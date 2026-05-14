// lib/bots/strategies/liquidation-lizard.ts
import { registerBot } from "../index";
import type {
  BotConfig,
  EntryDecision,
  ExternalSignals,
  MarketContext,
  PaperPosition,
  Strategy,
} from "../types";

const MIN_LIQ_NOTIONAL_USD = 50_000;
const LIQUIDATION_STALE_MS = 60_000;
const EXIT_FAVORABLE_PCT = 0.005; // +0.5%
const MAX_HOLD_MS = 90_000;
const ALLOWED_MARKETS = ["BTC", "ETH", "SOL"] as const;
const LEVERAGE = 50;

export const LiquidationLizardStrategy: Strategy = {
  id: "liquidation-lizard",
  markets: ALLOWED_MARKETS,

  evaluateEntry(
    ctx: MarketContext,
    signals: ExternalSignals,
  ): EntryDecision | null {
    if (!ALLOWED_MARKETS.includes(ctx.asset as (typeof ALLOWED_MARKETS)[number])) {
      return null;
    }
    const now = Date.now();
    const candidate = signals.liquidations.find(
      (l) =>
        l.asset === ctx.asset &&
        l.notionalUsd >= MIN_LIQ_NOTIONAL_USD &&
        now - l.ts <= LIQUIDATION_STALE_MS,
    );
    if (!candidate) return null;
    // Fade: if a long was liquidated (forced sell), the wick goes down — we
    // go long. If a short was liquidated (forced buy), we go short.
    const side: "long" | "short" =
      candidate.side === "long" ? "long" : "short";
    return {
      asset: ctx.asset,
      side,
      leverage: LEVERAGE,
      triggerMeta: {
        liquidationNotionalUsd: candidate.notionalUsd,
        liquidationSide: candidate.side,
        liquidationTs: candidate.ts,
      },
    };
  },

  evaluateExit(ctx: MarketContext, position: PaperPosition): boolean {
    const heldMs = Date.now() - position.entryTs.getTime();
    if (heldMs >= MAX_HOLD_MS) return true;
    const moveFrac = (ctx.mark - position.entryMark) / position.entryMark;
    const favorable =
      position.side === "long" ? moveFrac : -moveFrac;
    return favorable >= EXIT_FAVORABLE_PCT;
  },
};

const LiquidationLizardBot: BotConfig = {
  id: "liquidation-lizard",
  parentId: null,
  name: "Liquidation Lizard",
  avatarEmoji: "🦎",
  personaVoiceKey: "liquidation-lizard",
  strategyKey: "liquidation-lizard",
  config: {
    minLiqNotionalUsd: MIN_LIQ_NOTIONAL_USD,
    leverage: LEVERAGE,
    exitFavorablePct: EXIT_FAVORABLE_PCT,
    maxHoldMs: MAX_HOLD_MS,
  },
  status: "paper",
};

registerBot(LiquidationLizardBot, LiquidationLizardStrategy);
