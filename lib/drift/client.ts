import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  DriftClient,
  Wallet,
  initialize,
  getUserAccountPublicKey,
  PerpMarkets,
  SpotMarkets,
  BulkAccountLoader,
} from "@drift-labs/sdk";

// Drift's BulkAccountLoader sends batched getMultipleAccountsInfo, which
// Helius's free tier rejects (-32403). Use a batch-friendly RPC for the
// Drift client specifically. DRIFT_RPC_URL can override (e.g. paid Triton)
// or we fall back to public mainnet — slower but it supports batches.
const RPC_URL =
  process.env.DRIFT_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const sdkConfig = initialize({ env: "mainnet-beta" });
export const DRIFT_PROGRAM_ID = new PublicKey(sdkConfig.DRIFT_PROGRAM_ID);

let connection: Connection | null = null;
function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(RPC_URL, "confirmed");
  }
  return connection;
}

/**
 * Wallet shim that exposes a user's pubkey to the Drift SDK so that
 * instruction builders pick the right authority, but throws if the SDK
 * ever tries to sign locally — signing happens client-side via Privy.
 */
class ReadOnlyWallet {
  constructor(public publicKey: PublicKey) {}

  async signTransaction<T extends Transaction>(_tx: T): Promise<T> {
    throw new Error("ReadOnlyWallet cannot sign");
  }
  async signAllTransactions<T extends Transaction>(_txs: T[]): Promise<T[]> {
    throw new Error("ReadOnlyWallet cannot sign");
  }
}

// Markets we actually let users trade in MVP. SOL/BTC/ETH covers the
// dominant Hyperliquid whale activity and minimizes subscription cost.
const SUPPORTED_PERP_SYMBOLS = ["SOL-PERP", "BTC-PERP", "ETH-PERP"] as const;

export const SUPPORTED_PERP_INDEXES = PerpMarkets["mainnet-beta"]
  .filter((m) =>
    SUPPORTED_PERP_SYMBOLS.includes(m.symbol as (typeof SUPPORTED_PERP_SYMBOLS)[number]),
  )
  .map((m) => m.marketIndex);

const USDC_SPOT_MARKET_INDEX = 0;
export const SUPPORTED_SPOT_INDEXES = [USDC_SPOT_MARKET_INDEX];

const PERP_ORACLE_INFOS = PerpMarkets["mainnet-beta"]
  .filter((m) => SUPPORTED_PERP_INDEXES.includes(m.marketIndex))
  .map((m) => ({ publicKey: m.oracle, source: m.oracleSource }));

const SPOT_ORACLE_INFOS = SpotMarkets["mainnet-beta"]
  .filter((m) => SUPPORTED_SPOT_INDEXES.includes(m.marketIndex))
  .map((m) => ({ publicKey: m.oracle, source: m.oracleSource }));

export async function makeDriftClientForUser(
  userPubkey: PublicKey,
): Promise<DriftClient> {
  const conn = getConnection();
  const wallet = new ReadOnlyWallet(userPubkey) as unknown as Wallet;

  const accountLoader = new BulkAccountLoader(conn, "confirmed", 1000);

  const drift = new DriftClient({
    connection: conn,
    wallet,
    programID: DRIFT_PROGRAM_ID,
    env: "mainnet-beta",
    perpMarketIndexes: SUPPORTED_PERP_INDEXES,
    spotMarketIndexes: SUPPORTED_SPOT_INDEXES,
    oracleInfos: [...PERP_ORACLE_INFOS, ...SPOT_ORACLE_INFOS],
    accountSubscription: { type: "polling", accountLoader },
    skipLoadUsers: true,
  });

  await drift.subscribe();
  // Wait one polling cycle for the bulk loader to populate market state.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return drift;
}

export function perpMarketIndexFor(asset: string): number | null {
  const m = PerpMarkets["mainnet-beta"].find(
    (p) => p.baseAssetSymbol === asset.toUpperCase(),
  );
  if (!m) return null;
  if (!SUPPORTED_PERP_INDEXES.includes(m.marketIndex)) return null;
  return m.marketIndex;
}

export async function userHasDriftAccount(
  userPubkey: PublicKey,
): Promise<boolean> {
  const userPda = await getUserAccountPublicKey(
    DRIFT_PROGRAM_ID,
    userPubkey,
    0,
  );
  const info = await getConnection().getAccountInfo(userPda);
  return info !== null;
}

export { getConnection };
