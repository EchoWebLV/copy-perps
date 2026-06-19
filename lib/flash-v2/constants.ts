// lib/flash-v2/constants.ts
export type FlashCluster = "devnet" | "mainnet";

export const FLASH_V2_REST_BASE =
  process.env.FLASH_V2_REST_URL ?? "https://flashapi.trade/v2";

/** Mainnet USDC. Devnet uses a test mint — override with FLASH_V2_USDC_MINT. */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const FLASH_V2_USDC_MINT = process.env.FLASH_V2_USDC_MINT ?? USDC_MINT;

/** Protocol-fixed MagicBlock validator the basket delegates to (GOTCHAS). */
export const FLASH_V2_ER_VALIDATOR = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";

export const FLASH_V2_CLUSTER: FlashCluster =
  process.env.FLASH_V2_CLUSTER === "mainnet" ? "mainnet" : "devnet";

/** Gate: while false, nothing in this module is used by routes. */
export const FEATURE_FLASH_V2 = process.env.FEATURE_FLASH_V2 === "true";

export function resolveProgramId(cluster: FlashCluster): string {
  return cluster === "mainnet"
    ? "FTv2RxXarPfNta45HTTMVaGvjzsGg27FXJ3hEKWBhrzV"
    : "FMTgsEDaPPfJi1PKD67McLTC5n833T4irbBP53LLxtvj";
}

export function resolveErRpc(cluster: FlashCluster): string {
  if (process.env.FLASH_V2_ER_RPC) return process.env.FLASH_V2_ER_RPC;
  return cluster === "mainnet"
    ? "https://mainnet.magicblock.app"
    : "https://devnet.magicblock.app";
}

export function resolveBaseRpc(): string {
  return (
    process.env.FLASH_V2_BASE_RPC ??
    process.env.NEXT_PUBLIC_HELIUS_RPC_URL ??
    "https://api.devnet.solana.com"
  );
}
