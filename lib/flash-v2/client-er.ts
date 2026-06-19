// lib/flash-v2/client-er.ts
//
// Client-visible Flash v2 Ephemeral Rollup RPC endpoint. Self-directed v2 trades
// are user-signed, so the browser must broadcast the signed ER tx itself (Privy's
// submit can't resolve the ER / address-lookup tables). The ER is a public
// MagicBlock URL, so exposing it client-side is fine. Prefers a dedicated
// NEXT_PUBLIC_FLASH_V2_ER_RPC, falls back to the arena's already-inlined
// NEXT_PUBLIC_ARENA_ER_ENDPOINT (the same MagicBlock mainnet rollup the v2 venue
// executes on), then the mainnet default. A function so Next inlines the env at
// call time and it stays unit-testable via process.env.
export function flashV2ErRpc(): string {
  return (
    process.env.NEXT_PUBLIC_FLASH_V2_ER_RPC ||
    // Flash's own dedicated ER node (fresh oracle), NOT generic mainnet.
    "https://flashtrade.magicblock.app"
  );
}
