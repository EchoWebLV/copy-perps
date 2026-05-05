import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { getConnection } from "@/lib/solana/balance";

const secret = process.env.GAS_WALLET_PRIVATE_KEY;
if (!secret) {
  throw new Error("GAS_WALLET_PRIVATE_KEY is required");
}

export const gasWalletKeypair = Keypair.fromSecretKey(bs58.decode(secret));
export const gasWalletPubkey: PublicKey = gasWalletKeypair.publicKey;

// Per-request floor. If Gas Wallet is below this we refuse to build
// new bet txs — better than handing the client a tx that'll fail on
// submit. The operator-side refuel-trigger threshold lives in
// scripts/refuel-gas-wallet.mjs (1 SOL).
export const GAS_WALLET_MIN_BALANCE_SOL = 0.05;

export class GasWalletExhaustedError extends Error {
  constructor(public balance: number) {
    super(
      `Gas Wallet at ${balance.toFixed(4)} SOL — temporarily unable to open positions`,
    );
    this.name = "GasWalletExhaustedError";
  }
}

export async function ensureGasWalletReady(): Promise<void> {
  const conn = getConnection();
  const lamports = await conn.getBalance(gasWalletPubkey, "confirmed");
  const sol = lamports / 1_000_000_000;
  if (sol < GAS_WALLET_MIN_BALANCE_SOL) {
    throw new GasWalletExhaustedError(sol);
  }
}

// Adds Gas Wallet's signature at the fee-payer slot (index 0) of a
// VersionedTransaction. The user's signature is added on the client by
// Privy's signTransaction without overwriting this one.
export function partialSignAsFeePayer(tx: VersionedTransaction): void {
  tx.sign([gasWalletKeypair]);
}
