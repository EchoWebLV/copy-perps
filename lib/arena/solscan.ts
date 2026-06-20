// lib/arena/solscan.ts
//
// Cluster-aware verify links for the arena. Two layers, two explorers:
//   • The PROGRAM lives on the base layer → Solscan (`solscanAccountUrl`).
//   • The BOTS' decisions (apply_decision txs) execute on the MagicBlock
//     Ephemeral Rollup, which Solscan does NOT index. To see those you point
//     Solana Explorer at the ER via its custom-RPC param (`magicblockExplorer*`).
// Links/trust copy follow the cluster, never hardcode it (the verify claim is
// made on mainnet; devnet is demo-only).

/** The arena's live ER, used when an endpoint isn't passed through. */
const DEFAULT_ER_ENDPOINT = "https://eu.magicblock.app";

export function isDevnetEndpoint(erEndpoint: string | undefined): boolean {
  return (erEndpoint ?? "").toLowerCase().includes("devnet");
}

/** Base-layer Solscan account link (for the deployed program, init/delegate txs). */
export function solscanAccountUrl(
  address: string,
  erEndpoint: string | undefined,
): string {
  const suffix = isDevnetEndpoint(erEndpoint) ? "?cluster=devnet" : "";
  return `https://solscan.io/account/${address}${suffix}`;
}

function erCustomUrl(erEndpoint: string | undefined): string {
  return erEndpoint && erEndpoint.trim() ? erEndpoint : DEFAULT_ER_ENDPOINT;
}

/** Solana Explorer pointed at the ER (custom RPC). Shows the account AND its
 *  on-rollup transaction history — i.e. every apply_decision the bot made,
 *  which the base-layer Solscan link can never surface. */
export function magicblockExplorerAccountUrl(
  address: string,
  erEndpoint: string | undefined,
): string {
  return `https://explorer.solana.com/address/${address}?cluster=custom&customUrl=${encodeURIComponent(erCustomUrl(erEndpoint))}`;
}

/** Solana Explorer link to a single on-rollup transaction (one bot movement). */
export function magicblockExplorerTxUrl(
  signature: string,
  erEndpoint: string | undefined,
): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=${encodeURIComponent(erCustomUrl(erEndpoint))}`;
}
