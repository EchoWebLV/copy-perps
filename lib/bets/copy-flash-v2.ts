// lib/bets/copy-flash-v2.ts
//
// Flash v2 copy execution orchestration (session-signed, one-tap). The routes
// own auth/validation/DB; these helpers own the venue dance and return a
// discriminated result so the route maps it to a response + bet row. Funding is
// gated on `ensureOnboarded` only — collateral must be pre-deposited via the
// deposit route; balance-gated top-up is deferred to the mainnet-smoke phase.
import { Buffer } from "node:buffer";
import { getActiveSessionKey } from "@/lib/flash-v2/session-store";
import {
  executeSessionClose,
  executeSessionOpen,
} from "@/lib/flash-v2/session-trade";
import type { RpcLayer, Quote, Side } from "@/lib/flash-v2/types";
import type { FlashV2Venue } from "@/lib/flash-v2/venue";

export interface CopyOnboardStep {
  name: string;
  transactionB64: string;
  layer: RpcLayer;
}

export type CopyOpenFlashV2Result =
  | { kind: "enable-session" }
  | { kind: "onboard"; steps: CopyOnboardStep[] }
  | { kind: "opened"; signature: string; quote: Quote };

/**
 * Open a Flash v2 copy: needs a bound session (else the client must enable
 * auto-copy first) and an onboarded basket (else return the onboard steps). When
 * both hold, the session signs the open server-side — no popup.
 */
export async function openCopyFlashV2(args: {
  venue: Pick<FlashV2Venue, "ensureOnboarded" | "openPosition">;
  userId: string;
  owner: string;
  market: string;
  side: Side;
  stakeUsdc: number;
  leverage: number;
}): Promise<CopyOpenFlashV2Result> {
  const session = await getActiveSessionKey(args.userId);
  if (!session) return { kind: "enable-session" };

  const steps = await args.venue.ensureOnboarded(args.owner);
  if (steps.length > 0) {
    return {
      kind: "onboard",
      steps: steps.map((s) => ({
        name: s.name,
        transactionB64: Buffer.from(s.unsigned.tx.serialize()).toString("base64"),
        layer: s.unsigned.layer,
      })),
    };
  }

  const { signature, quote } = await executeSessionOpen({
    venue: args.venue,
    session,
    owner: args.owner,
    market: args.market,
    side: args.side,
    stakeUsdc: args.stakeUsdc,
    leverage: args.leverage,
  });
  return { kind: "opened", signature, quote };
}

export type CopyCloseFlashV2Result =
  | { kind: "no-session" }
  | { kind: "not-found" }
  | { kind: "closed"; signature: string; estPnlUsd: number | null };

/**
 * Close a Flash v2 copy via the session key. `no-session` ⇒ the session expired
 * or was never enabled (the route surfaces a re-enable prompt; a background
 * sweep skips). `not-found` ⇒ the position is already gone (mark the bet closed).
 */
export async function closeCopyFlashV2(args: {
  venue: Pick<FlashV2Venue, "getPositions" | "closePosition">;
  userId: string;
  owner: string;
  market: string;
  side: Side;
}): Promise<CopyCloseFlashV2Result> {
  const session = await getActiveSessionKey(args.userId);
  if (!session) return { kind: "no-session" };

  const result = await executeSessionClose({
    venue: args.venue,
    session,
    owner: args.owner,
    market: args.market,
    side: args.side,
  });
  if (!result.found) return { kind: "not-found" };
  return { kind: "closed", signature: result.signature, estPnlUsd: result.estPnlUsd };
}
