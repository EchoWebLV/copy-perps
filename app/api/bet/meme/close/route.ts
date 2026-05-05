import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import {
  buildSwapInstructions,
  buildSwapTx,
  getQuote,
  sellTokenForUsdc,
} from "@/lib/jupiter/swap";
import { getTokenAtomicBalance } from "@/lib/solana/balance";
import { USDC_MINT } from "@/lib/jupiter/constants";
import {
  ensureGasWalletReady,
  gasWalletPubkey,
  partialSignAsFeePayer,
  GasWalletExhaustedError,
} from "@/lib/wallets/gas";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    betId?: string;
  } | null;
  if (!body?.betId) {
    return NextResponse.json({ error: "betId required" }, { status: 400 });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.privyId, claims.userId))
    .limit(1);
  if (!user?.solanaPubkey) {
    return NextResponse.json({ error: "no wallet" }, { status: 400 });
  }

  const [bet] = await db
    .select()
    .from(bets)
    .where(and(eq(bets.id, body.betId), eq(bets.userId, user.id)))
    .limit(1);
  if (!bet || bet.status !== "confirmed" || bet.closedAt) {
    return NextResponse.json(
      { error: "bet not closeable" },
      { status: 400 },
    );
  }

  const meta = (bet.meta ?? {}) as Record<string, unknown>;
  const tokenAddress = meta.tokenAddress as string | undefined;
  const tokenAmount = (meta.actualOutAmount ?? meta.expectedOutAmount) as
    | string
    | undefined;
  if (!tokenAddress || !tokenAmount) {
    return NextResponse.json(
      { error: "bet missing token data" },
      { status: 400 },
    );
  }

  // The stored amount is the buy quote, not the on-chain delivered amount.
  // Buy slippage means the wallet typically holds slightly less, and asking
  // Jupiter to swap more than we hold trips an early-stage validation
  // (custom error 0x1788). Cap to actual balance — but never exceed the
  // per-bet quoted amount, so we don't bleed into another open position
  // that shares the same mint.
  let onChainBalance: bigint;
  try {
    onChainBalance = await getTokenAtomicBalance(
      user.solanaPubkey,
      tokenAddress,
    );
  } catch (err) {
    console.error("[bet/meme/close] balance read failed:", err);
    return NextResponse.json(
      { error: "could not read on-chain token balance" },
      { status: 502 },
    );
  }
  if (onChainBalance === 0n) {
    return NextResponse.json(
      { error: "no token balance on chain to close" },
      { status: 400 },
    );
  }
  const stored = BigInt(tokenAmount);
  const tokenAmountAtomic =
    onChainBalance < stored ? onChainBalance : stored;

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
      const quote = await getQuote({
        inputMint: tokenAddress,
        outputMint: USDC_MINT,
        amount: tokenAmountAtomic,
        slippageBps: 300,
      });
      const ixResp = await buildSwapInstructions({
        quoteResponse: quote,
        userPublicKey: user.solanaPubkey,
      });
      const tx = await buildSwapTx({
        ixResp,
        feePayer: gasWalletPubkey,
        appendInstructions: [],
      });
      partialSignAsFeePayer(tx);
      return NextResponse.json({
        swapTransaction: Buffer.from(tx.serialize()).toString("base64"),
        expectedUsdcOut: quote.outAmount,
      });
    } catch (err) {
      console.error("[bet/meme/close] Jupiter failed (gasless):", err);
      return NextResponse.json(
        { error: `Jupiter sell quote failed: ${String(err)}` },
        { status: 502 },
      );
    }
  }

  try {
    const result = await sellTokenForUsdc({
      inputMint: tokenAddress,
      tokenAmountAtomic,
      userPublicKey: user.solanaPubkey,
      slippageBps: 300,
    });
    return NextResponse.json({
      swapTransaction: result.swap.swapTransaction,
      expectedUsdcOut: result.quote.outAmount,
    });
  } catch (err) {
    console.error("[bet/meme/close] Jupiter failed:", err);
    return NextResponse.json(
      { error: `Jupiter sell quote failed: ${String(err)}` },
      { status: 502 },
    );
  }
}
