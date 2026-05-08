import { PublicKey } from "@solana/web3.js";

// SPL token program addresses. Constants because we don't depend on
// @solana/spl-token; deriving the few things we need here keeps the
// install graph slim.
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

// Standard ATA derivation: PDA of [owner, token program, mint] under the
// associated-token program. Matches getAssociatedTokenAddressSync from
// @solana/spl-token byte-for-byte.
export function getAssociatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

// SPL token account layout: amount is a little-endian u64 at byte 64.
// Account data is exactly 165 bytes; we only ever read the amount.
export function decodeTokenAmount(data: Buffer | Uint8Array): bigint {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < 72) return 0n;
  return buf.readBigUInt64LE(64);
}
