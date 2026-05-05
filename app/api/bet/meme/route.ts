import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { db } from "@/lib/db";
import { bets } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import {
  buildSwapInstructions,
  buildSwapTx,
  buyTokenWithUsdc,
  getQuote,
} from "@/lib/jupiter/swap";
import {
  ensureUsdcOrConsolidate,
  ensureUsdcOrConsolidateGasless,
  InsufficientCombinedBalanceError,
  requireSolForBet,
  InsufficientSolForFeesError,
} from "@/lib/usd/consolidate";
import {
  ensureGasWalletReady,
  gasWalletPubkey,
  partialSignAsFeePayer,
  GasWalletExhaustedError,
} from "@/lib/wallets/gas";
import { buildFeeTransferInstructions } from "@/lib/wallets/treasury";
import { computeBetFee } from "@/lib/fees/calc";
import { USDC_MINT } from "@/lib/jupiter/constants";
import type { MemeSignal } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    signal?: MemeSignal;
    amountUsdc?: number;
    walletAddress?: string;
  } | null;

  if (
    !body?.signal ||
    body.signal.type !== "meme" ||
    !body.signal.tokenAddress ||
    typeof body.amountUsdc !== "number"
  ) {
    return NextResponse.json(
      { error: "signal (meme with tokenAddress) and amountUsdc required" },
      { status: 400 },
    );
  }

  const memePayload: MemeSignal = body.signal;
  const amount = body.amountUsdc;
  if (amount <= 0 || amount > 1000) {
    return NextResponse.json(
      { error: "amount must be between 0 and 1000 USDC" },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json(
      { error: "no Solana wallet on user — pass walletAddress" },
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

    const fee = computeBetFee(amount);
    const requiredUsd = amount + fee.totalFeeUsdc;

    try {
      const consolidation = await ensureUsdcOrConsolidateGasless({
        userPubkey: user.solanaPubkey,
        requiredUsd,
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
      console.error("[bet/meme] consolidation check failed:", err);
      return NextResponse.json(
        { error: `Balance check failed: ${String(err)}` },
        { status: 502 },
      );
    }

    const userPk = new PublicKey(user.solanaPubkey);
    const inAmount = BigInt(Math.floor(amount * 1_000_000));
    const quote = await getQuote({
      inputMint: USDC_MINT,
      outputMint: memePayload.tokenAddress,
      amount: inAmount,
    });
    const ixResp = await buildSwapInstructions({
      quoteResponse: quote,
      userPublicKey: user.solanaPubkey,
    });
    const feeIxs = buildFeeTransferInstructions({
      userPubkey: userPk,
      feeUsdcDollars: fee.totalFeeUsdc,
      feePayerForAta: gasWalletPubkey,
    });
    const tx = await buildSwapTx({
      ixResp,
      feePayer: gasWalletPubkey,
      appendInstructions: feeIxs,
    });
    partialSignAsFeePayer(tx);

    const [bet] = await db
      .insert(bets)
      .values({
        userId: user.id,
        type: "meme",
        amountUsdc: amount,
        feeUsdc: fee.totalFeeUsdc,
        status: "pending",
        meta: {
          signalId: memePayload.id,
          tokenAddress: memePayload.tokenAddress,
          tokenSymbol: memePayload.ticker,
          tokenName: memePayload.name,
          entryPriceUsd: memePayload.price,
          expectedOutAmount: quote.outAmount,
          priceImpactPct: quote.priceImpactPct,
        },
      })
      .returning();

    return NextResponse.json({
      phase: "open",
      betId: bet.id,
      swapTransaction: Buffer.from(tx.serialize()).toString("base64"),
      expectedOutAmount: quote.outAmount,
      priceImpactPct: quote.priceImpactPct,
    });
  }

  // --- legacy path (FEATURE_GASLESS_BETS != "true") ---

  // SOL preflight — Jupiter swap creates the destination token ATA
  // inline, which needs rent. Surface a clear "low SOL" error before
  // simulation fails.
  try {
    await requireSolForBet(user.solanaPubkey);
  } catch (err) {
    if (err instanceof InsufficientSolForFeesError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // Meme buy goes USDC -> token via Jupiter swap. If user holds their
  // dollars as jupUSD (post-prediction-close), pre-swap the shortfall.
  try {
    const consolidation = await ensureUsdcOrConsolidate({
      userPubkey: user.solanaPubkey,
      requiredUsd: amount,
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
    console.error("[bet/meme] consolidation check failed:", err);
    return NextResponse.json(
      { error: `Balance check failed: ${String(err)}` },
      { status: 502 },
    );
  }

  let swapResult;
  try {
    swapResult = await buyTokenWithUsdc({
      outputMint: memePayload.tokenAddress,
      usdcDollars: amount,
      userPublicKey: user.solanaPubkey,
    });
  } catch (err) {
    console.error("[bet/meme] Jupiter failed:", err);
    return NextResponse.json(
      { error: `Jupiter quote failed: ${String(err)}` },
      { status: 502 },
    );
  }

  // signalId column left null — the signal originated client-side now,
  // not from the signals table, so the FK would fire. Keep the original
  // id in meta for traceability.
  const [bet] = await db
    .insert(bets)
    .values({
      userId: user.id,
      type: "meme",
      amountUsdc: amount,
      status: "pending",
      meta: {
        signalId: memePayload.id,
        tokenAddress: memePayload.tokenAddress,
        tokenSymbol: memePayload.ticker,
        tokenName: memePayload.name,
        entryPriceUsd: memePayload.price,
        expectedOutAmount: swapResult.quote.outAmount,
        priceImpactPct: swapResult.quote.priceImpactPct,
      },
    })
    .returning();

  return NextResponse.json({
    phase: "open",
    betId: bet.id,
    swapTransaction: swapResult.swap.swapTransaction,
    expectedOutAmount: swapResult.quote.outAmount,
    priceImpactPct: swapResult.quote.priceImpactPct,
  });
}
