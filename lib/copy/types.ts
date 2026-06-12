// lib/copy/types.ts
//
// Shared shapes for the Flash copy-trading engine (spec:
// docs/superpowers/specs/2026-06-12-flash-copy-trading.md).
//
// A "target" is who you copy: an arena bot (persona name, positions read
// from its ER account) or any Flash trader (wallet pubkey, positions read
// via positionsOf). A SourcePosition.key is the stable identity written
// into bets meta.sourcePositionId — the close pass matches on it, so the
// formats here are load-bearing:
//   arena bot     arena:<persona>:<openedTsMs>   (same as the Tail button)
//   flash wallet  flash:<wallet>:<market>:<side> (Flash merges per
//                 owner+market+side; no per-position id exists)

import type { FlashMarketSymbol } from "@/lib/flash/markets";

export type CopyTargetKind = "arena-bot" | "flash-wallet";

export interface CopyTargetRef {
  kind: CopyTargetKind;
  key: string;
}

/** Map key for per-target bookkeeping. */
export function copyTargetId(ref: CopyTargetRef): string {
  return `${ref.kind}:${ref.key}`;
}

export interface SourcePosition {
  /** Stable identity — becomes bets meta.sourcePositionId. */
  key: string;
  market: FlashMarketSymbol;
  side: "long" | "short";
  entryPriceUsd: number | null;
  leverage: number | null;
  /** Arena bots only; flash wallets expose no open timestamp. */
  openedTsMs: number | null;
}
