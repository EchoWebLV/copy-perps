// lib/arena/solscan.ts
//
// Cluster-aware Solscan links for the arena verify surfaces. The arena runs
// on whichever ER the env points at (devnet during development, mainnet since
// Phase 1.5) — links and trust copy must follow the cluster, never hardcode
// it (spec framing rule: the Solscan-verify claim is made on mainnet only;
// devnet is demo-only).

export function isDevnetEndpoint(erEndpoint: string | undefined): boolean {
  return (erEndpoint ?? "").toLowerCase().includes("devnet");
}

export function solscanAccountUrl(
  address: string,
  erEndpoint: string | undefined,
): string {
  const suffix = isDevnetEndpoint(erEndpoint) ? "?cluster=devnet" : "";
  return `https://solscan.io/account/${address}${suffix}`;
}
