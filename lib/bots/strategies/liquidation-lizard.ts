// lib/bots/strategies/liquidation-lizard.ts
import type {
  BotConfig,
  EntryDecision,
  ExternalSignals,
  MarketContext,
  PaperPosition,
  SyncStrategy,
} from "../types";
import { clampConviction } from "../types";

const LIQUIDATION_STALE_MS = 60_000;
const ALLOWED_MARKETS = ["BTC", "ETH", "SOL"] as const;

interface LizardParams {
  id: string;
  minLiqNotionalUsd: number;
  exitFavorablePct: number;
  maxHoldMs: number;
  leverage: number;
}

export function createLiquidationLizardStrategy(p: LizardParams): SyncStrategy {
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
      const now = Date.now();
      const candidate = signals.liquidations.find(
        (l) =>
          l.asset === ctx.asset &&
          l.notionalUsd >= p.minLiqNotionalUsd &&
          now - l.ts <= LIQUIDATION_STALE_MS,
      );
      if (!candidate) return null;
      const side: "long" | "short" = candidate.side;
      const conviction = clampConviction(candidate.notionalUsd / 200_000);
      return {
        asset: ctx.asset,
        side,
        leverage: p.leverage,
        conviction,
        triggerMeta: {
          liquidationNotionalUsd: candidate.notionalUsd,
          liquidationSide: candidate.side,
          liquidationTs: candidate.ts,
        },
      };
    },

    evaluateExit(ctx: MarketContext, position: PaperPosition): boolean {
      const heldMs = Date.now() - position.entryTs.getTime();
      if (heldMs >= p.maxHoldMs) return true;
      const moveFrac = (ctx.mark - position.entryMark) / position.entryMark;
      const favorable = position.side === "long" ? moveFrac : -moveFrac;
      return favorable >= p.exitFavorablePct;
    },
  };
}

export const LiquidationLizardStrategy = createLiquidationLizardStrategy({
  id: "liquidation-lizard",
  minLiqNotionalUsd: 50_000,
  exitFavorablePct: 0.005,
  maxHoldMs: 90_000,
  leverage: 50,
});

export const LiquidationLizardJrStrategy = createLiquidationLizardStrategy({
  id: "liquidation-lizard-jr",
  minLiqNotionalUsd: 15_000,
  exitFavorablePct: 0.003,
  maxHoldMs: 60_000,
  leverage: 50,
});

export const LiquidationLizardBot: BotConfig = {
  id: "liquidation-lizard",
  parentId: null,
  name: "Liquidation Lizard",
  avatarEmoji: "🦎",
  personaVoiceKey: "liquidation-lizard",
  strategyKey: "liquidation-lizard",
  config: {
    minLiqNotionalUsd: 50_000,
    leverage: 50,
    exitFavorablePct: 0.005,
    maxHoldMs: 90_000,
  },
  status: "paper",
};

export const LiquidationLizardJrBot: BotConfig = {
  id: "liquidation-lizard-jr",
  parentId: "liquidation-lizard",
  name: "Liquidation Lizard Jr.",
  avatarEmoji: "🦎",
  personaVoiceKey: "liquidation-lizard",
  strategyKey: "liquidation-lizard-jr",
  config: {
    minLiqNotionalUsd: 15_000,
    leverage: 50,
    exitFavorablePct: 0.003,
    maxHoldMs: 60_000,
  },
  status: "paper",
};
