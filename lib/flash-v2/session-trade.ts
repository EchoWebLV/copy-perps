// lib/flash-v2/session-trade.ts
//
// Server-driven (no-popup) Flash v2 execution via a bound session key. The venue
// builds an ER tx for the session signer; we add ONLY the session signature
// (never touch the validator's blockhash, notes §5) and submit to the ER. Shared
// by the copy rail (session-signed one-tap) and the mirror-close sweep (Task 7).
import { markPnlUsd } from "./pnl";
import {
  signTradeWithSession as defaultSign,
  submitErTx as defaultSubmit,
} from "./session";
import type { SessionKeyRecord } from "./session-store";
import type { Quote, Side } from "./types";
import type { FlashV2Venue, SessionRef } from "./venue";

/** Injection seam: tests swap sign/submit; production uses the ER defaults. */
export interface SessionExecDeps {
  sign?: typeof defaultSign;
  submit?: typeof defaultSubmit;
}

function sessionRef(s: SessionKeyRecord): SessionRef {
  return { signer: s.sessionPubkey, sessionToken: s.sessionTokenPda };
}

/**
 * Build → session-sign → submit a market open on the ER. Returns the ER tx
 * signature + the open quote. No wallet popup: the session key signs server-side.
 */
export async function executeSessionOpen(args: {
  venue: Pick<FlashV2Venue, "openPosition">;
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
  // Guard a partial/late indexer read (entryPrice/markPrice default to 0 in the
  // normalizer) so markPnlUsd never divides by zero and writes NaN/Infinity to
  // proceeds_usdc. null ⇒ "PnL unknown", same sentinel the Pacifica close uses.
  const estPnlUsd =
    pos.entryPrice > 0 && pos.markPrice > 0
      ? markPnlUsd({
          side: pos.side,
          entryPrice: pos.entryPrice,
          markPrice: pos.markPrice,
          sizeUsd: pos.sizeUsd,
        })
      : null;
  return { found: true, signature, estPnlUsd };
}
