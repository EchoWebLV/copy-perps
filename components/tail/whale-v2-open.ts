// components/tail/whale-v2-open.ts
//
// Pure helpers for the flag-gated flash-v2 whale-tail open path (Option A client
// repoint). TailModal owns the signing + phase loop + React state; these build
// the request body and adapt the server's open response, kept pure so they're
// unit-testable without Privy/hooks.
import type { WhaleTailPosition } from "./tail-types";

export interface WhaleV2Source {
  whaleId: string;
  sourceAccount: string;
  displayName: string;
}

/** Request body for POST /api/bet/whale. `source` is derived from the whaleId
 *  prefix; a snapshot is included so the open works even if the live whale cache
 *  has rotated the position out. */
export function buildWhaleV2Body(args: {
  whale: WhaleV2Source;
  position: WhaleTailPosition;
  stakeUsdc: number;
  leverage: number;
  walletAddress: string;
  autoCloseOnSourceClose: boolean;
}) {
  const source = args.whale.whaleId.startsWith("hyperliquid")
    ? "hyperliquid"
    : "pacifica";
  return {
    positionId: args.position.sourcePositionId,
    stakeUsdc: args.stakeUsdc,
    leverage: args.leverage,
    walletAddress: args.walletAddress,
    autoCloseOnSourceClose: args.autoCloseOnSourceClose,
    snapshot: {
      sourcePositionId: args.position.sourcePositionId,
      whaleId: args.whale.whaleId,
      source,
      sourceAccount: args.whale.sourceAccount,
      displayName: args.whale.displayName,
      market: args.position.asset,
      side: args.position.side,
      leverage: args.position.leverage,
      entryPrice: args.position.entryMark,
      currentMark: args.position.currentMark,
      lastSeenAtMs: args.position.lastSeenAtMs,
    },
  };
}

export interface FlashV2OpenSource {
  whaleId?: string;
  displayName?: string;
  asset: string;
  side: "long" | "short";
  leverage: number;
  autoCloseOnSourceClose?: boolean;
  detachedFromSource?: boolean;
}

/** Adapt the v2 `{ phase:'open', betId, txSig, source }` (already executed
 *  server-side via the session) onto the OpenResponse shape the success UI
 *  renders. No avg fill price / amount is returned, so show the venue + sig. */
export function flashV2WhaleOpenToOpenResponse(resp: {
  betId: string;
  txSig: string;
  source: FlashV2OpenSource;
}) {
  return {
    phase: "open" as const,
    betId: resp.betId,
    fill: {
      orderId: resp.txSig,
      avgFillPrice: "—",
      filledAmount: "Flash v2 position",
      side: resp.source.side,
    },
    source: resp.source,
  };
}
