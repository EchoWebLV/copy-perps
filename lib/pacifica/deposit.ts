import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { createHash } from "crypto";
import { getConnection } from "@/lib/solana/balance";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const PACIFICA_PROGRAM_ID = new PublicKey(
  "PCFA5iYgmqK6MqPhWNKg7Yv7auX7VZ4Cx7T1eJyrAMH",
);
const PACIFICA_CENTRAL_STATE = new PublicKey(
  "9Gdmhq4Gv1LnNMp7aiS1HSVd7pNnXNMsbuXALCQRmGjY",
);
const PACIFICA_VAULT = new PublicKey(
  "72R843XwZxqWhsJceARQQTTbYtWy6Zw9et2YV4FpRHTa",
);
const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);
const SYS_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

export class InsufficientWalletUsdcError extends Error {
  constructor(
    public requiredUsdc: number,
    public walletUsdc: number,
  ) {
    super(
      `Insufficient wallet USDC: need $${requiredUsdc.toFixed(2)}, have $${walletUsdc.toFixed(2)}`,
    );
    this.name = "InsufficientWalletUsdcError";
  }
}

function getDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

// Encode the deposit ix data: 8-byte discriminator || u64 amount
// (in USDC atomic units; 6 decimals).
function buildDepositIxData(amountUsdc: number): Buffer {
  const disc = getDiscriminator("deposit");
  const atomic = BigInt(Math.round(amountUsdc * 1_000_000));
  const amt = Buffer.alloc(8);
  amt.writeBigUInt64LE(atomic);
  return Buffer.concat([disc, amt]);
}

async function getAtaUsdcBalance(
  conn: ReturnType<typeof getConnection>,
  ata: PublicKey,
): Promise<number> {
  try {
    const balance = await conn.getTokenAccountBalance(ata, "confirmed");
    return Number(balance.value.amount) / 1_000_000;
  } catch (err) {
    if (/could not find account|Invalid param/i.test(String(err))) return 0;
    throw err;
  }
}

// Returns a base64-encoded unsigned v0 tx. The client sends it through
// Privy's sponsored Solana flow, so no server fee-payer key is needed.
export async function buildDepositTx(params: {
  userPubkey: PublicKey;
  amountUsdc: number;
}): Promise<{ transactionB64: string }> {
  const userUsdcAta = getAssociatedTokenAddressSync(
    USDC_MINT,
    params.userPubkey,
  );
  const conn = getConnection();
  const walletUsdc = await getAtaUsdcBalance(conn, userUsdcAta);
  if (walletUsdc + 0.000001 < params.amountUsdc) {
    throw new InsufficientWalletUsdcError(params.amountUsdc, walletUsdc);
  }
  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PACIFICA_PROGRAM_ID,
  );

  const ix = new TransactionInstruction({
    programId: PACIFICA_PROGRAM_ID,
    keys: [
      { pubkey: params.userPubkey, isSigner: true, isWritable: true },
      { pubkey: userUsdcAta, isSigner: false, isWritable: true },
      { pubkey: PACIFICA_CENTRAL_STATE, isSigner: false, isWritable: true },
      { pubkey: PACIFICA_VAULT, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: SYS_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PACIFICA_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: buildDepositIxData(params.amountUsdc),
  });

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: params.userPubkey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  return { transactionB64: Buffer.from(tx.serialize()).toString("base64") };
}
