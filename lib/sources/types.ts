// lib/sources/types.ts
//
// Shared types for the "source adapter" layer. Each adapter wraps a
// real-world signal source (an exchange wallet, a vault, a leaderboard
// trader) and exposes a uniform `getCurrentPositions()` interface so
// the generic source-mirror strategy doesn't need to know the source's
// API shape.

export interface SourcePosition {
  /** Stable identifier within the source. For an exchange wallet
   *  we use `${source}-${asset}` since one wallet can hold at most
   *  one position per asset. For vaults / multi-position-per-asset
   *  sources, include an order-id suffix.
   */
  externalId: string;
  asset: string;
  side: "long" | "short";
  entryPx: number;
  leverage: number;
  notionalUsd: number; // current notional (size × mark) on the source side
  openedAtMs: number | null; // best-effort; null if source doesn't expose it
  meta?: Record<string, unknown>;
}

/** A source adapter knows how to fetch the live position set for one
 *  specific external entity (a wallet, a vault, etc.). The mirror
 *  strategy calls it once per tick and diffs against the bot's own
 *  open positions to decide what to open/close. */
export interface Source {
  readonly id: string;          // unique within the codebase, e.g. "hl-wallet-0xb83de0..."
  readonly displayName: string; // shown in narrations / UI
  readonly externalUrl: string; // verify-on-chain link
  getCurrentPositions(): Promise<SourcePosition[]>;
}
