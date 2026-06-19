// lib/flash-v2/self-position.ts
//
// Maps a Flash v2 VenuePosition onto the FlashPosition shape the self-directed
// Trade tab (FastPerpsGame) renders, so the repoint is a positions-endpoint swap
// behind isFlashV2Client() with no change to the strip/graph/PnL UI.
//
// positionPubkey is DETERMINISTIC (`flashv2:<symbol>:<side>`) so an optimistic
// position synthesized client-side at open time reconciles against the polled
// venue position by the same key (the venue allows one position per market+side,
// so the pair is unique per owner). markPnlUsd matches the portfolio's own
// mark-price PnL; entry/mark guarded > 0 so a partial indexer read reads
// "unknown" (undefined) rather than a false break-even.
import { markPnlUsd } from "./pnl";
import type { Side, VenuePosition } from "./types";

/** Deterministic strip key for a self-directed v2 position. */
export function flashV2PositionKey(symbol: string, side: Side): string {
  return `flashv2:${symbol}:${side}`;
}

/** The serializable subset of FastPerpsGame's FlashPosition this rail produces.
 *  Structurally assignable to that client interface (triggers/openTime omitted —
 *  the venue snapshot has neither; the strip treats them as absent). openTime is
 *  deliberately omitted (not 0): the entry-cost cache's compatibleOpenTime treats
 *  a finite 0 as a real, far-in-the-past timestamp and would reject the merge,
 *  dropping the optimistic open fee; an absent openTime short-circuits it. */
export interface FlashV2SelfPosition {
  symbol: string;
  side: Side;
  positionPubkey: string;
  marketAccount: string;
  entryPriceUsd: number;
  markPriceUsd?: number;
  sizeUsd: number;
  collateralUsd: number;
  collateralSymbol: string;
  leverage?: number;
  liquidationPriceUsd?: number;
  pnlUsd?: number;
  isProfitable?: boolean;
}

export function venuePositionToFlashShape(p: VenuePosition): FlashV2SelfPosition {
  const hasPrices = p.entryPrice > 0 && p.markPrice > 0;
  const pnlUsd = hasPrices
    ? markPnlUsd({
        side: p.side,
        entryPrice: p.entryPrice,
        markPrice: p.markPrice,
        sizeUsd: p.sizeUsd,
        feesUsd: p.feesUsd,
        borrowUsd: p.borrowUsd,
      })
    : undefined;
  return {
    symbol: p.symbol,
    side: p.side,
    positionPubkey: flashV2PositionKey(p.symbol, p.side),
    marketAccount: p.positionKey,
    entryPriceUsd: p.entryPrice,
    markPriceUsd: p.markPrice > 0 ? p.markPrice : undefined,
    sizeUsd: p.sizeUsd,
    collateralUsd: p.collateralUsd,
    collateralSymbol: "USDC",
    leverage: p.leverage > 0 ? p.leverage : undefined,
    liquidationPriceUsd: p.liquidationPrice > 0 ? p.liquidationPrice : undefined,
    pnlUsd,
    isProfitable: pnlUsd != null ? pnlUsd >= 0 : undefined,
    // openTime intentionally omitted — see the interface note (a finite 0 would
    // defeat the entry-cost merge that carries the optimistic open fee).
  };
}
