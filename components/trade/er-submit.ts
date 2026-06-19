// components/trade/er-submit.ts
//
// Client broadcast for a user-signed Flash v2 Ephemeral Rollup tx. Self-directed
// v2 trades are signed by the user's Privy wallet (sign-only) and submitted by
// the browser to the ER RPC at 'processed' with skipPreflight — Privy's own
// submit can't resolve the ER / address-lookup tables (same reason CloseButton
// and WithdrawButton sign-only + broadcast themselves). Trades go to the ER,
// never the base layer.
//
// The builder bakes a STALE blockhash (verified: invalid on the ER the instant
// the tx is built), so we refresh recentBlockhash from the ER right before
// signing. The self-directed open/close is single-sig (owner only, no server
// partial-sig, no address-lookup tables), so replacing the blockhash invalidates
// nothing — and it's the only blockhash the ER will accept.
import {
  Connection,
  SendTransactionError,
  VersionedTransaction,
} from "@solana/web3.js";
import { flashV2ErRpc } from "@/lib/flash-v2/client-er";

/** Minimal connection surface so tests can inject a fake. */
export interface ErSubmitConnection {
  getLatestBlockhash: () => Promise<{
    blockhash: string;
    lastValidBlockHeight?: number;
  }>;
  sendRawTransaction: (
    tx: Uint8Array,
    opts: { skipPreflight: boolean; maxRetries: number },
  ) => Promise<string>;
}

export async function signAndSubmitErTx(args: {
  txBytes: Uint8Array;
  // Pre-bound signer (keeps this helper Privy-agnostic + testable): given the
  // unsigned tx bytes it returns the signed bytes (sign-only, no submit).
  sign: (txBytes: Uint8Array) => Promise<Uint8Array>;
  // Injectable for tests; production builds an ER Connection at 'processed'.
  makeConnection?: (rpc: string) => ErSubmitConnection;
  erRpc?: string;
}): Promise<string> {
  const rpc = args.erRpc ?? flashV2ErRpc();
  const conn: ErSubmitConnection = args.makeConnection
    ? args.makeConnection(rpc)
    : new Connection(rpc, "processed");

  // Refresh the (stale) builder blockhash with a current ER blockhash, then sign.
  const tx = VersionedTransaction.deserialize(args.txBytes);
  const { blockhash } = await conn.getLatestBlockhash();
  tx.message.recentBlockhash = blockhash;

  const signedTransaction = await args.sign(tx.serialize());
  try {
    return await conn.sendRawTransaction(signedTransaction, {
      skipPreflight: true,
      maxRetries: 3,
    });
  } catch (err) {
    if (err instanceof SendTransactionError) {
      const logs = await (err as SendTransactionError)
        .getLogs(conn as unknown as Connection)
        .catch(() => null);
      console.error("[trade-v2] ER submit sim logs:", logs);
    }
    throw err;
  }
}
