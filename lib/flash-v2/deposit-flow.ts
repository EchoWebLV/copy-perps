// lib/flash-v2/deposit-flow.ts
import { Buffer } from "node:buffer";
import type { VersionedTransaction } from "@solana/web3.js";
import type { RpcLayer } from "./types";
import type { FlashV2Venue } from "./venue";

function txToB64(tx: VersionedTransaction): string {
  return Buffer.from(tx.serialize()).toString("base64");
}

/** A funding step the client must sign+submit, in order, on the named layer. */
export interface FlashV2DepositStep {
  name: string;
  transactionB64: string;
  layer: RpcLayer;
}

export type FlashV2DepositPlan =
  | { phase: "onboard"; steps: FlashV2DepositStep[] }
  | { phase: "deposit"; depositTransaction: string; layer: RpcLayer };

/**
 * Plan a Flash v2 funding action. A fresh basket needs init-basket →
 * init-deposit-ledger → delegate-basket (all base-layer) before any deposit can
 * land, so when onboarding is incomplete we return those steps; the client
 * signs them in order then re-calls and gets the deposit tx. All txs are
 * serialized base64 for the JSON response.
 */
export async function planFlashV2Deposit(args: {
  venue: Pick<FlashV2Venue, "ensureOnboarded" | "deposit">;
  owner: string;
  amountUsdc: number;
  tokenMint: string;
}): Promise<FlashV2DepositPlan> {
  const steps = await args.venue.ensureOnboarded(args.owner);
  if (steps.length > 0) {
    return {
      phase: "onboard",
      steps: steps.map((s) => ({
        name: s.name,
        transactionB64: txToB64(s.unsigned.tx),
        layer: s.unsigned.layer,
      })),
    };
  }
  const dep = await args.venue.deposit({
    owner: args.owner,
    amountUsdc: args.amountUsdc,
    tokenMint: args.tokenMint,
  });
  return { phase: "deposit", depositTransaction: txToB64(dep.tx), layer: dep.layer };
}
