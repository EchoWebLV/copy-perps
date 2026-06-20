// lib/flash-v2/constants.ts
export type FlashCluster = "devnet" | "mainnet";

export const FLASH_V2_REST_BASE =
  process.env.FLASH_V2_REST_URL ?? "https://flashapi.trade/v2";

/** Mainnet USDC. Devnet uses a test mint — override with FLASH_V2_USDC_MINT. */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const FLASH_V2_USDC_MINT = process.env.FLASH_V2_USDC_MINT ?? USDC_MINT;

/**
 * Flash v2 minimum deposit. The venue builds $1 deposits/opens (confirmed live),
 * so v2 funding does NOT inherit Pacifica's $10 floor — a $1 stake must fund a $1
 * basket. The only real venue minimum ($11) is triggers-only, not market orders.
 */
export const FLASH_V2_MIN_DEPOSIT_USDC = 1;

/** Max leverage the Flash v2 venue builds (degen tier, confirmed live). Both the
 *  self-directed Trade rail and the whale-copy rail validate against this; the
 *  venue stays the final authority on any per-market ceiling below it. */
export const MAX_FLASH_V2_LEVERAGE = 500;

/** Flash's dedicated ER node the basket delegates to (served at
 *  flashtrade.magicblock.app), confirmed via router getDelegationStatus +
 *  getIdentity. NOT the generic mainnet node MAS1Dt9 (stale oracle for baskets). */
export const FLASH_V2_ER_VALIDATOR = "FLAshCJGr4SWk23bDVy7yeZecfND8h5Cingy1u2XE6HQ";

export const FLASH_V2_CLUSTER: FlashCluster =
  process.env.FLASH_V2_CLUSTER === "mainnet" ? "mainnet" : "devnet";

/** Gate: while false, nothing in this module is used by routes. */
export const FEATURE_FLASH_V2 = process.env.FEATURE_FLASH_V2 === "true";

/** MagicBlock session-keys program (Keysp); same id on mainnet + devnet. */
export const KEYSP_PROGRAM_ID = "KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5";
/** SessionTokenV2 PDA seed prefix — the "_v2" is load-bearing (session notes §3). */
export const SESSION_TOKEN_V2_SEED = "session_token_v2";
/** The program hard-rejects valid_until beyond now + 7d (ValidityTooLong). */
export const MAX_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Default session lifetime — short on purpose (the server custodies the secret). */
export const DEFAULT_SESSION_TTL_SECONDS = 12 * 60 * 60;
/** One-time rent top-up funding the session token (refunded on revoke). */
export const SESSION_TOPUP_LAMPORTS = Math.round(0.01 * 1e9);

export function resolveProgramId(cluster: FlashCluster): string {
  return cluster === "mainnet"
    ? "FTv2RxXarPfNta45HTTMVaGvjzsGg27FXJ3hEKWBhrzV"
    : "FMTgsEDaPPfJi1PKD67McLTC5n833T4irbBP53LLxtvj";
}

export function resolveErRpc(cluster: FlashCluster): string {
  if (process.env.FLASH_V2_ER_RPC) return process.env.FLASH_V2_ER_RPC;
  // Flash v2 baskets delegate to Flash's OWN dedicated ER node
  // (identity FLAshCJGr4SWk23bDVy7yeZecfND8h5Cingy1u2XE6HQ), served at
  // flashtrade.magicblock.app — NOT the generic mainnet.magicblock.app node
  // (MAS1Dt9), whose oracle is stale for these baskets (open fails 6006
  // InvalidOraclePrice). The router can't resolve it ("unknown ER node") because
  // it's Flash-hosted, so this endpoint is pinned here.
  return cluster === "mainnet"
    ? "https://flashtrade.magicblock.app"
    : "https://devnet.magicblock.app";
}

export function resolveBaseRpc(): string {
  return (
    process.env.FLASH_V2_BASE_RPC ??
    process.env.NEXT_PUBLIC_HELIUS_RPC_URL ??
    "https://api.devnet.solana.com"
  );
}
