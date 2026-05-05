import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { getConnection } from "@/lib/solana/balance";

// Lazy. Importing this module never reads env vars — the keypair is
// built on first call to getGasWalletKeypair(). Lets routes import gas
// helpers safely even when GAS_WALLET_PRIVATE_KEY isn't set (legacy
// code path keeps working without the env var).
let _kp: Keypair | null = null;
export function getGasWalletKeypair(): Keypair {
  if (_kp) return _kp;
  const secret = process.env.GAS_WALLET_PRIVATE_KEY;
  if (!secret) {
    throw new Error(
      "GAS_WALLET_PRIVATE_KEY is required for the gasless bet path",
    );
  }
  _kp = Keypair.fromSecretKey(bs58.decode(secret));
  return _kp;
}

export function getGasWalletPubkey(): PublicKey {
  return getGasWalletKeypair().publicKey;
}

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
  const lamports = await conn.getBalance(getGasWalletPubkey(), "confirmed");
  const sol = lamports / 1_000_000_000;
  if (sol < GAS_WALLET_MIN_BALANCE_SOL) {
    throw new GasWalletExhaustedError(sol);
  }
}

// Adds Gas Wallet's signature at the fee-payer slot (index 0) of a
// VersionedTransaction. The user's signature is added on the client by
// Privy's signTransaction without overwriting this one.
export function partialSignAsFeePayer(tx: VersionedTransaction): void {
  tx.sign([getGasWalletKeypair()]);
}

const PREFUND_TARGET_SOL = 0.005;
const PREFUND_SKIP_THRESHOLD_SOL = 0.005;

// Per-ATA rent (Solana standard). Jupiter's setupInstructions include
// a "create destination token ATA" ix that charges this rent to the
// *userPublicKey* we passed Jupiter — not to our fee payer. Without
// an in-tx drip the user's 0-lamport wallet fails ATA creation with
// custom program error 0x1.
const ATA_RENT_LAMPORTS = 2_039_280; // SPL token ATA, exact

// Rent-exempt minimum for an empty system account. Solana refuses to
// let any modified account settle below this. If we drip exactly the
// ATA rent, the user's wallet ends at 0 lamports after the create-ATA
// ix and the tx fails with "insufficient funds for rent" on account
// index 1. Drip enough extra to leave the user rent-exempt.
const SYSTEM_RENT_EXEMPT_MIN_LAMPORTS = 890_880;

// Small headroom — covers Solana's per-tx priority fees and any
// minor fluctuation in the rent-exempt min between runtime versions.
const SOL_DRIP_BUFFER_LAMPORTS = 250_000;

// Returns a single SystemProgram.transfer ix that drips enough SOL
// from Gas Wallet → user to cover N new ATAs' rent AND leave the
// user's system account rent-exempt afterwards. Returns null when no
// drip is needed (numAtasToFund = 0).
//
// Drip math:
//   N * ATA_RENT       — paid out to each new ATA's account
//   + SYSTEM_RENT_EXEMPT_MIN — what the user's wallet must hold AFTER
//   + buffer
//
// Used inside Jupiter swap txs (meme buy, consolidation) where Jupiter
// hard-codes the user as the ATA funder. Place the returned ix BEFORE
// Jupiter's setupInstructions so the lamports land in the user's
// wallet before the ATA-create ix runs in the same tx.
export function buildUserSolDripIx(params: {
  userPubkey: PublicKey;
  numAtasToFund: number;
}): TransactionInstruction | null {
  if (params.numAtasToFund <= 0) return null;
  const lamports =
    params.numAtasToFund * ATA_RENT_LAMPORTS +
    SYSTEM_RENT_EXEMPT_MIN_LAMPORTS +
    SOL_DRIP_BUFFER_LAMPORTS;
  return SystemProgram.transfer({
    fromPubkey: getGasWalletPubkey(),
    toPubkey: params.userPubkey,
    lamports,
  });
}

// Returns a base64-encoded prefund tx (Gas Wallet as fee payer). When
// the user already has enough SOL for the upcoming Jupiter Prediction
// tx, no SOL drip is added — but appendInstructions (the USDC fee
// transfer) are still bundled, so the fee gets collected atomically in
// the same tx the user signs to authorize the trade.
export async function buildPredictionPrefundTx(params: {
  userPubkey: PublicKey;
  appendInstructions: TransactionInstruction[];
}): Promise<string> {
  const conn = getConnection();
  const userLamports = await conn.getBalance(params.userPubkey, "confirmed");
  const userSol = userLamports / 1_000_000_000;

  const ixs: TransactionInstruction[] = [];
  const gasPk = getGasWalletPubkey();
  if (userSol < PREFUND_SKIP_THRESHOLD_SOL) {
    const dripSol = PREFUND_TARGET_SOL - userSol;
    const dripLamports = Math.ceil(dripSol * 1_000_000_000);
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: gasPk,
        toPubkey: params.userPubkey,
        lamports: dripLamports,
      }),
    );
  }
  ixs.push(...params.appendInstructions);

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: gasPk,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  partialSignAsFeePayer(tx);
  return Buffer.from(tx.serialize()).toString("base64");
}
