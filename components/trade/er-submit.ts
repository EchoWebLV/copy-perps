// components/trade/er-submit.ts
//
// Client broadcast for a user-signed Flash v2 Ephemeral Rollup tx. Self-directed
// v2 trades are signed by the user's Privy wallet (sign-only) and submitted by
// the browser to the ER RPC at 'processed' with skipPreflight — Privy's own
// submit can't resolve the ER / address-lookup tables (same reason CloseButton
// and WithdrawButton sign-only + broadcast themselves). Trades go to the ER,
// never the base layer.
import { Connection, SendTransactionError } from "@solana/web3.js";
import { flashV2ErRpc } from "@/lib/flash-v2/client-er";

/** Minimal submit surface so tests can inject a fake connection. */
export interface ErSubmitConnection {
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
  const signedTransaction = await args.sign(args.txBytes);
  const rpc = args.erRpc ?? flashV2ErRpc();
  const conn: ErSubmitConnection = args.makeConnection
    ? args.makeConnection(rpc)
    : new Connection(rpc, "processed");
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
