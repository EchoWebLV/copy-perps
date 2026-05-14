// lib/bots/strategies/funding-phoebe.ts
import type {
  BotConfig,
  EntryDecision,
  ExternalSignals,
  MarketContext,
  PaperPosition,
  SyncStrategy,
} from "../types";

const ALLOWED_MARKETS = [
  "BTC",
  "ETH",
  "SOL",
  "HYPE",
  "BNB",
  "XRP",
  "DOGE",
  "AVAX",
] as const;

interface PhoebeParams {
  id: string;
  fundingThreshold: number;
  exitFavorablePct: number;
  maxHoldMs: number;
  leverage: number;
}

export function createFundingPhoebeStrategy(p: PhoebeParams): SyncStrategy {
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
      const funding = signals.funding[ctx.asset];
      if (funding === undefined) return null;
      if (Math.abs(funding) < p.fundingThreshold) return null;
      // Positive funding = longs paying shorts → fade by shorting.
      // Negative funding = shorts paying longs → fade by longing.
      const side: "long" | "short" = funding > 0 ? "short" : "long";
      return {
        asset: ctx.asset,
        side,
        leverage: p.leverage,
        triggerMeta: {
          entryFunding: funding,
          fundingThreshold: p.fundingThreshold,
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

export const FundingPhoebeStrategy = createFundingPhoebeStrategy({
  id: "funding-phoebe",
  fundingThreshold: 0.0001,
  exitFavorablePct: 0.008,
  maxHoldMs: 4 * 60 * 60 * 1000,
  leverage: 20,
});

export const FundingPhoebeLiteStrategy = createFundingPhoebeStrategy({
  id: "funding-phoebe-lite",
  fundingThreshold: 0.00005,
  exitFavorablePct: 0.005,
  maxHoldMs: 2 * 60 * 60 * 1000,
  leverage: 20,
});

export const FundingPhoebeBot: BotConfig = {
  id: "funding-phoebe",
  parentId: null,
  name: "Funding Phoebe",
  avatarEmoji: "📊",
  personaVoiceKey: "funding-phoebe",
  strategyKey: "funding-phoebe",
  config: {
    fundingThreshold: 0.0001,
    exitFavorablePct: 0.008,
    maxHoldMs: 4 * 60 * 60 * 1000,
    leverage: 20,
  },
  status: "paper",
};

export const FundingPhoebeLiteBot: BotConfig = {
  id: "funding-phoebe-lite",
  parentId: "funding-phoebe",
  name: "Funding Phoebe Lite",
  avatarEmoji: "📊",
  personaVoiceKey: "funding-phoebe",
  strategyKey: "funding-phoebe-lite",
  config: {
    fundingThreshold: 0.00005,
    exitFavorablePct: 0.005,
    maxHoldMs: 2 * 60 * 60 * 1000,
    leverage: 20,
  },
  status: "paper",
};
