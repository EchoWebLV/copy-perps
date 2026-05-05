import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { USDC_MINT, USDC_DECIMALS } from "@/lib/jupiter/constants";

const treasuryStr = process.env.TREASURY_PUBKEY;
if (!treasuryStr) {
  throw new Error("TREASURY_PUBKEY is required");
}

export const treasuryPubkey = new PublicKey(treasuryStr);
const usdcMintPk = new PublicKey(USDC_MINT);
const treasuryUsdcAta = getAssociatedTokenAddressSync(usdcMintPk, treasuryPubkey);

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

  return [
    createAssociatedTokenAccountIdempotentInstruction(
      params.feePayerForAta,
      treasuryUsdcAta,
      treasuryPubkey,
      usdcMintPk,
    ),
    createTransferCheckedInstruction(
      userUsdcAta,
      usdcMintPk,
      treasuryUsdcAta,
      params.userPubkey,
      amountAtomic,
      USDC_DECIMALS,
    ),
  ];
}
