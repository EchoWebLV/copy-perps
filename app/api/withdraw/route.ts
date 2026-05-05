import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { getConnection } from "@/lib/solana/balance";
import { USDC_MINT, USDC_DECIMALS } from "@/lib/jupiter/constants";
import {
  ensureUsdcOrConsolidate,
  ensureUsdcOrConsolidateGasless,
  InsufficientCombinedBalanceError,
  requireSolForBet,
  InsufficientSolForFeesError,
} from "@/lib/usd/consolidate";
import {
  ensureGasWalletReady,
  getGasWalletPubkey,
  partialSignAsFeePayer,
  GasWalletExhaustedError,
} from "@/lib/wallets/gas";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const USDC_MINT_PK = new PublicKey(USDC_MINT);

function isValidPubkey(s: string): boolean {
  try {
    const pk = new PublicKey(s);
    return PublicKey.isOnCurve(pk);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    destination?: string;
    amountUsd?: number;
  } | null;
  if (
    !body?.destination ||
    typeof body.amountUsd !== "number" ||
    body.amountUsd <= 0
  ) {
    return NextResponse.json(
      { error: "destination and amountUsd required" },
      { status: 400 },
    );
  }
  if (!isValidPubkey(body.destination)) {
    return NextResponse.json(
      { error: "destination is not a valid Solana address" },
      { status: 400 },
    );
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.privyId, claims.userId))
    .limit(1);
  if (!user?.solanaPubkey) {
    return NextResponse.json({ error: "no wallet" }, { status: 400 });
  }
  if (user.solanaPubkey === body.destination) {
    return NextResponse.json(
      { error: "destination must be different from your own wallet" },
      { status: 400 },
    );
  }

  const gasless = process.env.FEATURE_GASLESS_BETS === "true";

  if (gasless) {
    try {
      await ensureGasWalletReady();
    } catch (err) {
      if (err instanceof GasWalletExhaustedError) {
        return NextResponse.json({ error: err.message }, { status: 503 });
      }
      throw err;
    }

    try {
      const consolidation = await ensureUsdcOrConsolidateGasless({
        userPubkey: user.solanaPubkey,
        requiredUsd: body.amountUsd,
      });
      if (!consolidation.ready) {
        return NextResponse.json({
          phase: "consolidate",
          consolidationTransaction: consolidation.consolidationTransaction,
          usdcBalance: consolidation.usdcBalance,
          jupUsdBalance: consolidation.jupUsdBalance,
          requiredUsd: consolidation.requiredUsd,
        });
      }
    } catch (err) {
      if (err instanceof InsufficientCombinedBalanceError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      console.error("[withdraw] consolidation check failed:", err);
      return NextResponse.json(
        { error: `Balance check failed: ${String(err)}` },
        { status: 502 },
      );
    }

    const senderPk = new PublicKey(user.solanaPubkey);
    const destinationPk = new PublicKey(body.destination);
    const senderAta = getAssociatedTokenAddressSync(USDC_MINT_PK, senderPk);
    const destAta = getAssociatedTokenAddressSync(USDC_MINT_PK, destinationPk);
    const amountAtomic = BigInt(
      Math.floor(body.amountUsd * 10 ** USDC_DECIMALS),
    );

    const conn = getConnection();
    const { blockhash } = await conn.getLatestBlockhash("confirmed");

    // Same instructions as the legacy path, but Gas Wallet is the fee
    // payer and pays the (idempotent) destination-ATA rent if needed.
    const message = new TransactionMessage({
      payerKey: getGasWalletPubkey(),
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50 }),
        createAssociatedTokenAccountIdempotentInstruction(
          getGasWalletPubkey(),
          destAta,
          destinationPk,
          USDC_MINT_PK,
        ),
        createTransferCheckedInstruction(
          senderAta,
          USDC_MINT_PK,
          destAta,
          senderPk,
          amountAtomic,
          USDC_DECIMALS,
        ),
      ],
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    partialSignAsFeePayer(tx);

    return NextResponse.json({
      phase: "transfer",
      transferTransaction: Buffer.from(tx.serialize()).toString("base64"),
      amountUsd: body.amountUsd,
      destination: body.destination,
    });
  }

  // --- legacy path (FEATURE_GASLESS_BETS != "true") ---

  // SOL preflight — sender pays tx fees + may pay rent for the
  // destination's USDC ATA (if it doesn't exist yet, ~0.00203 SOL).
  try {
    await requireSolForBet(user.solanaPubkey);
  } catch (err) {
    if (err instanceof InsufficientSolForFeesError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // If the user is short USDC but has jupUSD, kick the consolidate
  // dance same as a bet: client signs the swap, retries this endpoint,
  // then we hand back the actual transfer.
  try {
    const consolidation = await ensureUsdcOrConsolidate({
      userPubkey: user.solanaPubkey,
      requiredUsd: body.amountUsd,
    });
    if (!consolidation.ready) {
      return NextResponse.json({
        phase: "consolidate",
        consolidationTransaction: consolidation.consolidationTransaction,
        usdcBalance: consolidation.usdcBalance,
        jupUsdBalance: consolidation.jupUsdBalance,
        requiredUsd: consolidation.requiredUsd,
      });
    }
  } catch (err) {
    if (err instanceof InsufficientCombinedBalanceError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[withdraw] consolidation check failed:", err);
    return NextResponse.json(
      { error: `Balance check failed: ${String(err)}` },
      { status: 502 },
    );
  }

  const senderPk = new PublicKey(user.solanaPubkey);
  const destinationPk = new PublicKey(body.destination);

  const senderAta = getAssociatedTokenAddressSync(USDC_MINT_PK, senderPk);
  const destAta = getAssociatedTokenAddressSync(USDC_MINT_PK, destinationPk);

  const amountAtomic = BigInt(
    Math.floor(body.amountUsd * 10 ** USDC_DECIMALS),
  );

  const conn = getConnection();
  const { blockhash } = await conn.getLatestBlockhash("confirmed");

  const tx = new Transaction({
    feePayer: senderPk,
    recentBlockhash: blockhash,
  });
  // Tiny prio fee so the transfer lands in the next block.
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }));
  tx.add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50 }),
  );
  // Idempotent ATA creation pays no rent if the destination already has
  // a USDC account; first-time recipients get one initialised inline.
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      senderPk,
      destAta,
      destinationPk,
      USDC_MINT_PK,
    ),
  );
  tx.add(
    createTransferCheckedInstruction(
      senderAta,
      USDC_MINT_PK,
      destAta,
      senderPk,
      amountAtomic,
      USDC_DECIMALS,
    ),
  );

  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  return NextResponse.json({
    phase: "transfer",
    transferTransaction: Buffer.from(serialized).toString("base64"),
    amountUsd: body.amountUsd,
    destination: body.destination,
  });
}
