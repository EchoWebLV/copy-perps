// lib/bots/types.ts
import type { FundingSignal } from "@/lib/data/cex-funding";
export type { FundingSignal };

export interface BotConfig {
  id: string;
  parentId: string | null;
  name: string;
  avatarEmoji: string;
  personaVoiceKey: string;
  strategyKey: string;
  config: Record<string, unknown>;
  status: "paper" | "backtest-fail" | "live" | "retired" | "busted";
}

export interface PaperPosition {
  id: string;
  botId: string;
  asset: string;
  side: "long" | "short";
  leverage: number;
  stakeUsd: number; // NEW
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
  conviction: number; // 0..1, clamped to [0.3, 1.0] in practice
  triggerMeta: Record<string, unknown>;
}

export interface LiquidationEvent {
  asset: string;
  side: "long" | "short"; // which side got liquidated
  notionalUsd: number;
  ts: number; // unix ms
  source: "hyperliquid";
}

export interface WhaleOpenEvent {
  asset: string;
  side: "long" | "short";
  notionalUsd: number;
  px: number;
  ts: number;
  whaleAddress: string;
  source: "hyperliquid";
}

/** Lightweight cross-bot snapshot passed into strategies that want to
 *  react to roster-wide positioning (e.g. Contrarian fades the consensus).
 *  Just the (asset|side) count map — strategies don't need the full
 *  CrossBotSnapshot. */
export interface CrossBotPositioning {
  /** key: `${asset}|long` or `${asset}|short` → count of bots holding that side */
  positionsByAssetSide: Map<string, number>;
}

export interface ExternalSignals {
  // Recent liquidation events (last ~2 min rolling buffer)
  liquidations: LiquidationEvent[];
  // Per-asset funding signal aggregated across all venues (Binance, Bybit, OKX, dYdX)
  funding: Record<string, FundingSignal>;
  // Recent whale entries (last ~5 min rolling buffer) from curated HL wallets.
  // Optional so legacy tests/fixtures don't need updating; resolver always populates it.
  whaleOpens?: WhaleOpenEvent[];
  // Snapshot of other paper-bots' open positions — Contrarian fades consensus.
  // Optional for the same reason; resolver always populates it.
  crossBot?: CrossBotPositioning;
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

/**
 * Clamp a raw "strength" measure to a conviction value in [floor, ceiling].
 * Default range [0.3, 1.0] keeps every triggered trade meaningfully-sized
 * (no $30 stakes at conviction 0.0) while still varying by signal strength.
 */
export function clampConviction(
  raw: number,
  floor: number = 0.3,
  ceiling: number = 1.0,
): number {
  if (!Number.isFinite(raw)) return floor;
  return Math.min(ceiling, Math.max(floor, raw));
}
