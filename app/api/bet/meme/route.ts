import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { signals, bets, users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { buyTokenWithUsdc } from "@/lib/jupiter/swap";
import {
  ensureUsdcOrConsolidate,
  InsufficientCombinedBalanceError,
} from "@/lib/usd/consolidate";
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
    signalId?: string;
    amountUsdc?: number;
    walletAddress?: string;
  } | null;

  if (!body?.signalId || typeof body.amountUsdc !== "number") {
    return NextResponse.json(
      { error: "signalId and amountUsdc required" },
      { status: 400 },
    );
  }

  const amount = body.amountUsdc;
  if (amount <= 0 || amount > 1000) {
    return NextResponse.json(
      { error: "amount must be between 0 and 1000 USDC" },
      { status: 400 },
    );
  }

  const [signalRow] = await db
    .select()
    .from(signals)
    .where(eq(signals.id, body.signalId))
    .limit(1);

  if (!signalRow || signalRow.type !== "meme") {
    return NextResponse.json(
      { error: "signal not found or wrong type" },
      { status: 400 },
    );
  }

  const memePayload = signalRow.payload as MemeSignal;
  if (!memePayload.tokenAddress) {
    return NextResponse.json(
      { error: "signal missing tokenAddress" },
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

  const [bet] = await db
    .insert(bets)
    .values({
      userId: user.id,
      signalId: signalRow.id,
      type: "meme",
      amountUsdc: amount,
      status: "pending",
      meta: {
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
