import { Connection, SendTransactionError } from "@solana/web3.js";
import bs58 from "bs58";
import type { useSignTransaction } from "@privy-io/react-auth/solana";
import type { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";

const RPC_URL =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ?? "https://api.mainnet-beta.solana.com";

export function decodeBase64Tx(b64: unknown, label: string): Uint8Array {
  if (typeof b64 !== "string" || b64.length === 0) {
    throw new Error(
      `${label}: expected base64 string, got ${typeof b64} (${
        typeof b64 === "string" ? "empty" : String(b64).slice(0, 40)
      })`,
    );
  }
  try {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch (err) {
    throw new Error(
      `${label}: base64 decode failed (len=${b64.length}, head="${b64.slice(0, 40)}…"): ${String(err)}`,
    );
  }
}

// Sign + send via Helius. Privy's built-in submit can't resolve ALTs
// (needed for Jupiter swaps and Flash perps), so we sign-only and
// broadcast through web3.js.
export async function signAndSubmitTx(
  txBytes: Uint8Array,
  wallet: ReturnType<typeof useEmbeddedSolanaWallet>,
  signTransaction: ReturnType<typeof useSignTransaction>["signTransaction"],
): Promise<string> {
  if (!wallet) throw new Error("Wallet not ready");
  const result = (await signTransaction({
    transaction: txBytes,
    wallet,
  })) as { signedTransaction: Uint8Array };
  const conn = new Connection(RPC_URL, "confirmed");
  try {
    return await conn.sendRawTransaction(result.signedTransaction, {
      skipPreflight: false,
      maxRetries: 3,
    });
  } catch (err) {
    if (err instanceof SendTransactionError) {
      const logs = await err.getLogs(conn).catch(() => null);
      console.error("[bet] sim logs:", logs);
    }
    throw err;
  }
}

export function bs58Encode(bytes: Uint8Array): string {
  return bs58.encode(bytes);
}

// Wraps the consolidate/open dance:
//   1. POST to `url`. Server returns either { phase: "open", ... } or
//      { phase: "consolidate", consolidationTransaction }.
//   2. If consolidate: sign + broadcast the swap, wait for chain
//      confirmation, then re-call the same endpoint with the same body.
//   3. Server now sees enough USDC and returns phase "open".
// Returns the final phase=open response.
export async function postBetWithConsolidation(
  url: string,
  body: unknown,
  token: string,
  wallet: ReturnType<typeof useEmbeddedSolanaWallet>,
  signTransaction: ReturnType<typeof useSignTransaction>["signTransaction"],
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      throw new Error(b.error ?? `HTTP ${r.status}`);
    }
    const data = (await r.json()) as Record<string, unknown>;
    console.log(
      `[bet ${url}] attempt=${attempt} phase=${String(data.phase)} keys=[${Object.keys(data).join(",")}]`,
    );
    if (data.phase === "consolidate") {
      if (attempt > 0) {
        throw new Error("consolidation didn't clear after retry");
      }
      const swapBytes = decodeBase64Tx(
        data.consolidationTransaction,
        "consolidation tx",
      );
      const sig = await signAndSubmitTx(swapBytes, wallet, signTransaction);
      const conn = new Connection(RPC_URL, "confirmed");
      const result = await conn.confirmTransaction(sig, "confirmed");
      if (result.value.err) {
        throw new Error(
          `Consolidation swap failed on chain: ${JSON.stringify(result.value.err)}`,
        );
      }
      // RPC propagation buffer — Jupiter Prediction's API may hit a
      // different RPC than ours; without this, the next call sometimes
      // sees stale balance and rejects with INSUFFICIENT_FUNDS even
      // though the swap landed.
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    if (data.prefundTransaction && typeof data.prefundTransaction === "string") {
      // Prediction-rail atomic prefund: sign + submit the prefund tx
      // (drips SOL to user + sweeps USDC fee to Treasury), wait for
      // confirmation, then fall through to return `data` so the caller
      // signs + submits the actual prediction swap.
      const prefundBytes = decodeBase64Tx(
        data.prefundTransaction,
        "prefund tx",
      );
      const sig = await signAndSubmitTx(prefundBytes, wallet, signTransaction);
      const conn = new Connection(RPC_URL, "confirmed");
      const result = await conn.confirmTransaction(sig, "confirmed");
      if (result.value.err) {
        throw new Error(
          `Prefund tx failed on chain: ${JSON.stringify(result.value.err)}`,
        );
      }
      // Strip prefundTransaction from the returned shape so the caller
      // doesn't accidentally re-submit it.
      const { prefundTransaction: _drop, ...rest } = data;
      void _drop;
      return rest;
    }
    return data;
  }
  throw new Error("consolidation loop exhausted");
}
