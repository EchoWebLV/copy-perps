// lib/bots/types.ts

export interface BotConfig {
  id: string;
  parentId: string | null;
  name: string;
  avatarEmoji: string;
  personaVoiceKey: string;
  strategyKey: string;
  config: Record<string, unknown>;
  status: "paper" | "backtest-fail" | "live" | "retired";
}

export interface PaperPosition {
  id: string;
  botId: string;
  asset: string;
  side: "long" | "short";
  leverage: number;
  entryMark: number;
  entryTs: Date;
  exitMark: number | null;
  exitTs: Date | null;
  paperPnlUsd: number | null;
  triggerMeta: Record<string, unknown> | null;
  narrationOpen: string | null;
  narrationClose: string | null;
  status: "open" | "closed" | "expired";
}

export interface EntryDecision {
  asset: string;
  side: "long" | "short";
  leverage: number;
  triggerMeta: Record<string, unknown>;
}

export interface LiquidationEvent {
  asset: string;
  side: "long" | "short"; // which side got liquidated
  notionalUsd: number;
  ts: number; // unix ms
  source: "hyperliquid";
}

export interface ExternalSignals {
  // Recent liquidation events (e.g. last 60s, rolling buffer)
  liquidations: LiquidationEvent[];
  // Per-asset funding rate from primary venue (Binance in Phase 1)
  funding: Record<string, number>;
}

export interface MarketContext {
  asset: string;
  mark: number;
  // Future-extensible: candles by timeframe come in Phase 2
}

export interface Strategy {
  readonly id: string;
  readonly markets: readonly string[];
  evaluateEntry(
    ctx: MarketContext,
    signals: ExternalSignals,
  ): EntryDecision | null | Promise<EntryDecision | null>;
  evaluateExit(
    ctx: MarketContext,
    position: PaperPosition,
  ): boolean;
}

/** Sync-only specialisation — satisfies Strategy, but evaluateEntry is guaranteed synchronous. */
export interface SyncStrategy extends Strategy {
  evaluateEntry(
    ctx: MarketContext,
    signals: ExternalSignals,
  ): EntryDecision | null;
}
