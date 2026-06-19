// lib/flash-v2/session-trade.ts
//
// Server-driven (no-popup) Flash v2 execution via a bound session key. The venue
// builds an ER tx for the session signer; we add ONLY the session signature
// (never touch the validator's blockhash, notes §5) and submit to the ER. Shared
// by the copy rail (session-signed one-tap) and the mirror-close sweep (Task 7).
import { markPnlUsd } from "./pnl";
import { FlashV2PositionConflictError } from "./self-trade";
import { FlashV2TxFailedError } from "./errors";
import {
  signTradeWithSession as defaultSign,
  submitErTx as defaultSubmit,
  confirmErTx as defaultConfirm,
} from "./session";
import type { SessionKeyRecord } from "./session-store";
import type { Quote, Side } from "./types";
import type { FlashV2Venue, SessionRef } from "./venue";

/** Injection seam: tests swap sign/submit/confirm; production uses the ER defaults. */
export interface SessionExecDeps {
  sign?: typeof defaultSign;
  submit?: typeof defaultSubmit;
  confirm?: typeof defaultConfirm;
}

function sessionRef(s: SessionKeyRecord): SessionRef {
  return { signer: s.sessionPubkey, sessionToken: s.sessionTokenPda };
}

/**
 * Build → session-sign → submit a market open on the ER. Returns the ER tx
 * signature + the open quote. No wallet popup: the session key signs server-side.
 */
export async function executeSessionOpen(args: {
  venue: Pick<FlashV2Venue, "openPosition" | "getPositions">;
  session: SessionKeyRecord;
  owner: string;
  market: string;
  side: Side;
  stakeUsdc: number;
  leverage: number;
  deps?: SessionExecDeps;
}): Promise<{ signature: string; quote: Quote }> {
  const sign = args.deps?.sign ?? defaultSign;
  const submit = args.deps?.submit ?? defaultSubmit;
  const confirm = args.deps?.confirm ?? defaultConfirm;
  // On-chain duplicate guard (mirrors planFlashV2Open on the self-trade rail).
  // The venue nets by (account, symbol), so opening a second position on a
  // market that already has one — including an orphan with no bet row or a
  // self-directed position — would merge them; a later close would then close
  // the whole and misattribute PnL. The DB-only hasOpenTailOnMarket guard can't
  // see those, so we re-check on-chain here. Symbol-only (any side) by design.
  const existing = await args.venue.getPositions(args.owner);
  if (existing.some((p) => p.symbol === args.market)) {
    throw new FlashV2PositionConflictError(args.market);
  }
  const { unsigned, quote } = await args.venue.openPosition({
    owner: args.owner,
    symbol: args.market,
    collateralUsd: args.stakeUsdc,
    leverage: args.leverage,
    side: args.side,
    orderType: "market",
    session: sessionRef(args.session),
  });
  const signed = sign(unsigned.tx, args.session.keypair.secretKey);
  const signature = await submit(signed);
  // Resolve the ER outcome (submitErTx is fire-and-forget). A definite on-chain
  // FAILURE throws so the route reports "no funds were spent" and records no
  // confirmed bet. On "pending" (neither confirmed nor failed within the budget)
  // we don't guess: we re-read on-chain positions as ground truth. If the market
  // isn't there, the open didn't land, so we throw rather than record a confirmed
  // ghost bet — the inverse of the conflict precheck above, keeping the rail
  // self-healing on both edges.
  const outcome = await confirm(signature);
  if (outcome === "failed") throw new FlashV2TxFailedError(signature, "open");
  if (outcome === "pending") {
    const after = await args.venue.getPositions(args.owner);
    if (!after.some((p) => p.symbol === args.market)) {
      throw new FlashV2TxFailedError(signature, "open");
    }
  }
  return { signature, quote };
}

/**
 * Close a live position via the session key. Routes by position presence:
 * `{ found: false }` when the wallet has no matching Flash v2 position (the
 * caller treats it as already-closed). `estPnlUsd` is a mark-price estimate
 * (the venue exposes no realized-PnL read yet), consistent with the portfolio.
 */
export async function executeSessionClose(args: {
  venue: Pick<FlashV2Venue, "getPositions" | "closePosition">;
  session: SessionKeyRecord;
  owner: string;
  market: string;
  side: Side;
  deps?: SessionExecDeps;
}): Promise<{ found: true; signature: string; estPnlUsd: number | null } | { found: false }> {
  const sign = args.deps?.sign ?? defaultSign;
  const submit = args.deps?.submit ?? defaultSubmit;
  const confirm = args.deps?.confirm ?? defaultConfirm;
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
    session: sessionRef(args.session),
  });
  const signed = sign(unsigned.tx, args.session.keypair.secretKey);
  const signature = await submit(signed);
  // Resolve the ER outcome. A definite FAILURE throws so the bet stays
  // `confirmed` (retryable) instead of recorded closed against a live position.
  // On "pending" we re-read on-chain ground truth: if the (symbol, side) is STILL
  // present the close did not land — throw rather than record false proceeds and
  // orphan a still-open position with no recovery path. If it's gone, it landed.
  const outcome = await confirm(signature);
  if (outcome === "failed") throw new FlashV2TxFailedError(signature, "close");
  if (outcome === "pending") {
    const after = await args.venue.getPositions(args.owner);
    if (after.some((p) => p.symbol === args.market && p.side === args.side)) {
      throw new FlashV2TxFailedError(signature, "close");
    }
  }
  // Guard a partial/late indexer read (entryPrice/markPrice default to 0 in the
  // normalizer) so markPnlUsd never divides by zero and writes NaN/Infinity to
  // proceeds_usdc. null ⇒ "PnL unknown", same sentinel the Pacifica close uses.
  // feesUsd/borrowUsd are forwarded when the venue exposes them; the current
  // owner snapshot omits both, so they stay undefined (gross mark PnL, kept
  // consistent with the live portfolio number) until the venue surfaces a
  // realized-fee read — see lib/flash-v2/query.ts.
  const estPnlUsd =
    pos.entryPrice > 0 && pos.markPrice > 0
      ? markPnlUsd({
          side: pos.side,
          entryPrice: pos.entryPrice,
          markPrice: pos.markPrice,
          sizeUsd: pos.sizeUsd,
          feesUsd: pos.feesUsd,
          borrowUsd: pos.borrowUsd,
        })
      : null;
  return { found: true, signature, estPnlUsd };
}
