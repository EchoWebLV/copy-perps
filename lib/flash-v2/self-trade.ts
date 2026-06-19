// lib/flash-v2/self-trade.ts
import { Buffer } from "node:buffer";
import type { VersionedTransaction } from "@solana/web3.js";
import { markPnlUsd } from "./pnl";
import type { Quote, RpcLayer, Side } from "./types";
import type { FlashV2Venue } from "./venue";

function txToB64(tx: VersionedTransaction): string {
  return Buffer.from(tx.serialize()).toString("base64");
}

/** Open would duplicate a live position on the same market. */
export class FlashV2PositionConflictError extends Error {
  constructor(public market: string) {
    super(`you already have an open ${market} position - close it first`);
    this.name = "FlashV2PositionConflictError";
  }
}

export interface FlashV2OpenPlan {
  phase: "open";
  transactionB64: string;
  layer: RpcLayer;
  quote: Quote;
}

/**
 * Build a self-directed Flash v2 open: reject a duplicate market, then return
 * the unsigned ER tx + quote for the user's wallet to sign. No session — this is
 * the popup-signed self-trade path (server-driven copy uses a SessionRef).
 * `getMarkets()` is still a stub, so leverage/market validation lives in the
 * route (generic bounds) + the REST builder; the only venue precheck here is the
 * duplicate-position guard via the implemented `getPositions`.
 */
export async function planFlashV2Open(args: {
  venue: Pick<FlashV2Venue, "getPositions" | "openPosition">;
  owner: string;
  market: string;
  side: Side;
  stakeUsdc: number;
  leverage: number;
}): Promise<FlashV2OpenPlan> {
  const positions = await args.venue.getPositions(args.owner);
  if (positions.some((p) => p.symbol === args.market)) {
    throw new FlashV2PositionConflictError(args.market);
  }
  const { unsigned, quote } = await args.venue.openPosition({
    owner: args.owner,
    symbol: args.market,
    collateralUsd: args.stakeUsdc,
    leverage: args.leverage,
    side: args.side,
    orderType: "market",
  });
  return {
    phase: "open",
    transactionB64: txToB64(unsigned.tx),
    layer: unsigned.layer,
    quote,
  };
}

export interface FlashV2ClosePlan {
  phase: "close";
  transactionB64: string;
  layer: RpcLayer;
  // null when the indexer hasn't populated entry/mark price (avoid NaN PnL).
  estPnlUsd: number | null;
  market: string;
  side: Side;
}

/**
 * Build a self-directed Flash v2 close keyed on (market, side). Routes by
 * position presence, not a persisted bet row: returns `{ found: false }` when
 * the wallet has no matching Flash v2 position so the caller can fall through to
 * the Pacifica close path (a position opened on Pacifica must close on Pacifica,
 * even after the flag flips — never strand it). `estPnlUsd` is a mark-price
 * estimate; realized PnL is read from the venue after the tx lands.
 */
export async function planFlashV2Close(args: {
  venue: Pick<FlashV2Venue, "getPositions" | "closePosition">;
  owner: string;
  market: string;
  side: Side;
}): Promise<{ found: true; plan: FlashV2ClosePlan } | { found: false }> {
  const positions = await args.venue.getPositions(args.owner);
  const pos = positions.find(
    (p) => p.symbol === args.market && p.side === args.side,
  );
  if (!pos) return { found: false };

  const { unsigned } = await args.venue.closePosition({
    owner: args.owner,
    symbol: args.market,
    side: args.side,
    closeUsd: pos.sizeUsd,
  });
  // null when entry/mark price aren't populated (avoid NaN from a 0 entry).
  const estPnlUsd =
    pos.entryPrice > 0 && pos.markPrice > 0
      ? markPnlUsd({
          side: pos.side,
          entryPrice: pos.entryPrice,
          markPrice: pos.markPrice,
          sizeUsd: pos.sizeUsd,
        })
      : null;
  return {
    found: true,
    plan: {
      phase: "close",
      transactionB64: txToB64(unsigned.tx),
      layer: unsigned.layer,
      estPnlUsd,
      market: args.market,
      side: args.side,
    },
  };
}
