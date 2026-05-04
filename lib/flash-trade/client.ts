import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import { PerpetualsClient, PoolConfig } from "flash-sdk";

// Drift's RPC env shadowed Helius before; reuse the same env so ops can
// keep one paid endpoint configured. Flash Trade uses standard Solana
// RPC plus Pyth Hermes (already wired by the SDK).
const RPC_URL =
  process.env.FLASH_RPC_URL ??
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ??
  "https://api.mainnet-beta.solana.com";

// Crypto.1 pool — main perp pool with SOL/BTC/ETH against USDC. Other
// pools (Virtual.1, Trump.1, etc.) are themed and don't list majors.
export const POOL_CONFIG = PoolConfig.fromIdsByName("Crypto.1", "mainnet-beta");

const SUPPORTED_PERP_SYMBOLS = ["SOL", "BTC", "ETH"] as const;
export type FlashPerpSymbol = (typeof SUPPORTED_PERP_SYMBOLS)[number];

export function flashSymbolFor(asset: string): FlashPerpSymbol | null {
  const upper = asset.toUpperCase();
  return (SUPPORTED_PERP_SYMBOLS as readonly string[]).includes(upper)
    ? (upper as FlashPerpSymbol)
    : null;
}

let cachedConn: Connection | null = null;
export function getConnection(): Connection {
  if (!cachedConn) cachedConn = new Connection(RPC_URL, "confirmed");
  return cachedConn;
}

// Wallet shim that exposes a user's pubkey to the SDK so instruction
// builders pick the right authority. Flash never asks us to sign — the
// SDK methods we use return `{instructions, additionalSigners}` for the
// caller to assemble. Privy signs on the client side.
class ReadOnlyWallet {
  constructor(public publicKey: PublicKey) {}
  async signTransaction<T extends Transaction>(_tx: T): Promise<T> {
    throw new Error("ReadOnlyWallet cannot sign");
  }
  async signAllTransactions<T extends Transaction>(_txs: T[]): Promise<T[]> {
    throw new Error("ReadOnlyWallet cannot sign");
  }
}

const clientCache = new Map<string, PerpetualsClient>();

export function makeFlashClient(userPubkey: PublicKey): PerpetualsClient {
  const key = userPubkey.toBase58();
  const cached = clientCache.get(key);
  if (cached) return cached;

  const provider = new AnchorProvider(
    getConnection(),
    new ReadOnlyWallet(userPubkey) as unknown as AnchorProvider["wallet"],
    {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
      skipPreflight: true,
    },
  );

  const client = new PerpetualsClient(
    provider,
    POOL_CONFIG.programId,
    POOL_CONFIG.perpComposibilityProgramId,
    POOL_CONFIG.fbNftRewardProgramId,
    POOL_CONFIG.rewardDistributionProgram.programId,
    { prioritizationFee: 0 },
  );
  clientCache.set(key, client);
  return client;
}
