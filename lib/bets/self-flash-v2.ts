// lib/bets/self-flash-v2.ts
//
// Flash v2 SELF-DIRECTED (Trade tab) execution — the v1-style one-tap experience
// on v2. Identical machinery to the copy rail (lib/bets/copy-flash-v2.ts): a
// bound session key signs trades server-side (no per-trade popup); funding
// (onboard + deposit) is a one-time client dance gated here. The only difference
// from copy is there's no leader and no persisted bet row — self-directed
// positions are read live from the venue by /api/trade/perp/positions.
import { getActiveSessionKey } from "@/lib/flash-v2/session-store";
import {
  executeSessionOpen,
  executeSessionClose,
} from "@/lib/flash-v2/session-trade";
import type { RpcLayer, Quote, Side } from "@/lib/flash-v2/types";
import type { FlashV2Venue } from "@/lib/flash-v2/venue";

export interface SelfOnboardStep {
  name: string;
  transactionB64: string;
  layer: RpcLayer;
}

export type OpenSelfFlashV2Result =
  | { kind: "enable-session" }
  | { kind: "onboard"; steps: SelfOnboardStep[] }
  | { kind: "opened"; signature: string; quote: Quote };

/**
 * Open a self-directed Flash v2 position. Returns a discriminated phase the route
 * maps to a response: `enable-session` (no bound session ⇒ client enables one),
 * `onboard` (basket not created ⇒ client signs the base-layer setup steps), or
 * `opened` (session signed the open server-side, no popup). Funding the basket
 * (deposit) is the client's job between `onboard` and a successful `opened` —
 * executeSessionOpen verifies on-chain, so an unfunded open throws rather than
 * recording a ghost.
 */
export async function openSelfFlashV2(args: {
  venue: Pick<FlashV2Venue, "ensureOnboarded" | "openPosition" | "getPositions">;
  userId: string;
  owner: string;
  market: string;
  side: Side;
  stakeUsdc: number;
  leverage: number;
}): Promise<OpenSelfFlashV2Result> {
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

export type CloseSelfFlashV2Result =
  | { kind: "no-session" }
  | { kind: "not-found" }
  | { kind: "closed"; signature: string; estPnlUsd: number | null };

/**
 * Close a self-directed Flash v2 position via the session key (no popup).
 * `no-session` ⇒ session expired/never enabled (route surfaces a re-enable
 * prompt). `not-found` ⇒ no matching live position (route falls through to the
 * Pacifica close path so a v1 position is never stranded).
 */
export async function closeSelfFlashV2(args: {
  venue: Pick<FlashV2Venue, "getPositions" | "closePosition">;
  userId: string;
  owner: string;
  market: string;
  side: Side;
}): Promise<CloseSelfFlashV2Result> {
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
