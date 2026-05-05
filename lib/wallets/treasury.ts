import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { USDC_MINT, USDC_DECIMALS } from "@/lib/jupiter/constants";

// Lazy — same reasoning as lib/wallets/gas.ts. Routes can import this
// module safely; the env-var check fires only when Treasury actually
// gets used (i.e. on the gasless path).
let _treasuryPubkey: PublicKey | null = null;
let _treasuryUsdcAta: PublicKey | null = null;

function getTreasuryPubkey(): PublicKey {
  if (_treasuryPubkey) return _treasuryPubkey;
  const treasuryStr = process.env.TREASURY_PUBKEY;
  if (!treasuryStr) {
    throw new Error(
      "TREASURY_PUBKEY is required for the gasless bet path",
    );
  }
  _treasuryPubkey = new PublicKey(treasuryStr);
  return _treasuryPubkey;
}

function getTreasuryUsdcAta(): PublicKey {
  if (_treasuryUsdcAta) return _treasuryUsdcAta;
  _treasuryUsdcAta = getAssociatedTokenAddressSync(
    new PublicKey(USDC_MINT),
    getTreasuryPubkey(),
  );
  return _treasuryUsdcAta;
}

export { getTreasuryPubkey };
const usdcMintPk = new PublicKey(USDC_MINT);

// Returns a pair of instructions:
//   1. Idempotent create of Treasury's USDC ATA (no-op after first call).
//   2. TransferChecked of `feeUsdcDollars` USDC from user's USDC ATA to
//      Treasury's USDC ATA. User must sign for the transfer.
//
// `feePayerForAta` is the wallet that pays rent for the create-ATA ix on
// first ever call. In our flow this is always the Gas Wallet (since
// it's the tx fee payer anyway).
export function buildFeeTransferInstructions(params: {
  userPubkey: PublicKey;
  feeUsdcDollars: number;
  feePayerForAta: PublicKey;
}): TransactionInstruction[] {
  const userUsdcAta = getAssociatedTokenAddressSync(usdcMintPk, params.userPubkey);
  const amountAtomic = BigInt(
    Math.ceil(params.feeUsdcDollars * 10 ** USDC_DECIMALS),
  );

  const treasuryPk = getTreasuryPubkey();
  const treasuryAta = getTreasuryUsdcAta();
  return [
    createAssociatedTokenAccountIdempotentInstruction(
      params.feePayerForAta,
      treasuryAta,
      treasuryPk,
      usdcMintPk,
    ),
    createTransferCheckedInstruction(
      userUsdcAta,
      usdcMintPk,
      treasuryAta,
      params.userPubkey,
      amountAtomic,
      USDC_DECIMALS,
    ),
  ];
}
