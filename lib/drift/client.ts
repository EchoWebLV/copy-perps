import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  DriftClient,
  Wallet,
  initialize,
  getUserAccountPublicKey,
  PerpMarkets,
  SpotMarkets,
  BulkAccountLoader,
} from "@drift-labs/sdk";

// Drift's nested @coral-xyz/anchor pins an older @solana/web3.js,
// so the Connection/Keypair types from our top-level @solana/web3.js
// don't structurally match Drift's expected types even though they're
// runtime-identical. Cast at the seam.
type DriftCompatConnection = ConstructorParameters<typeof Connection>[0] extends never
  ? never
  : Connection;

// Drift's BulkAccountLoader sends batched getMultipleAccountsInfo, which
// the Helius free tier rejects. Either set DRIFT_RPC_URL to a paid
// batch-friendly RPC, or rely on NEXT_PUBLIC_HELIUS_RPC_URL once on a
// paid Helius tier (which is the current setup).
const RPC_URL =
  process.env.DRIFT_RPC_URL ??
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ??
  "https://api.mainnet-beta.solana.com";

const sdkConfig = initialize({ env: "mainnet-beta" });
export const DRIFT_PROGRAM_ID = new PublicKey(sdkConfig.DRIFT_PROGRAM_ID);

let cachedConnection: Connection | null = null;
export function getConnection(): Connection {
  if (!cachedConnection) {
    cachedConnection = new Connection(RPC_URL, "confirmed");
  }
  return cachedConnection;
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

// Cache DriftClient instances per user pubkey within a warm function instance.
const clientCache = new Map<string, Promise<DriftClient>>();

export function makeDriftClientForUser(
  userPubkey: PublicKey,
): Promise<DriftClient> {
  const key = userPubkey.toBase58();
  const existing = clientCache.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const conn = getConnection() as unknown as DriftCompatConnection;
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
    });

    await drift.subscribe();
    return drift;
  })();

  clientCache.set(key, promise);
  return promise;
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

export function perpMarketIndexFor(asset: string): number | null {
  const m = PerpMarkets["mainnet-beta"].find(
    (p) => p.baseAssetSymbol === asset.toUpperCase(),
  );
  if (!m) return null;
  if (!SUPPORTED_PERP_INDEXES.includes(m.marketIndex)) return null;
  return m.marketIndex;
}
