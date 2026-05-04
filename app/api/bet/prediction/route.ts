import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { signals, bets } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { createOrder } from "@/lib/jupiter-prediction/client";
import {
  ensureUsdcOrConsolidate,
  InsufficientCombinedBalanceError,
} from "@/lib/usd/consolidate";
import type { PredictionSignal, MultiPredictionSignal } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

// Jupiter Prediction's createOrder enforces a minimum of $5 — but its
// "minimum" is checked against contracts AFTER fees, so a $5 deposit
// can land just under $5 in contract value and reject. Floor our minimum
// at $5.50 so the after-fee order always clears.
const MIN_USDC = 5.5;
const MAX_USDC = 1000;

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    signalId?: string;
    outcome?: "yes" | "no";
    amountUsdc?: number;
    walletAddress?: string;
    marketId?: string;
    outcomeLabel?: string;
  } | null;

  if (
    !body?.signalId ||
    (body.outcome !== "yes" && body.outcome !== "no") ||
    typeof body.amountUsdc !== "number"
  ) {
    return NextResponse.json(
      { error: "signalId, outcome (yes|no), amountUsdc required" },
      { status: 400 },
    );
  }

  if (body.amountUsdc < MIN_USDC || body.amountUsdc > MAX_USDC) {
    return NextResponse.json(
      { error: `amount must be between $${MIN_USDC} and $${MAX_USDC}` },
      { status: 400 },
    );
  }

  const [signalRow] = await db
    .select()
    .from(signals)
    .where(eq(signals.id, body.signalId))
    .limit(1);

  if (
    !signalRow ||
    (signalRow.type !== "prediction" && signalRow.type !== "multiprediction")
  ) {
    return NextResponse.json(
      { error: "signal not found or wrong type" },
      { status: 400 },
    );
  }

  // Resolve marketId + outcome label, branching on signal flavor.
  let resolvedMarketId: string | null = null;
  let resolvedOutcomeLabel: string | undefined;
  let resolvedQuestion: string;
  let entryYesProbability: number | undefined;

  if (signalRow.type === "prediction") {
    const p = signalRow.payload as PredictionSignal;
    if (!p.marketId) {
      return NextResponse.json(
        { error: "signal missing marketId" },
        { status: 400 },
      );
    }
    resolvedMarketId = p.marketId;
    resolvedQuestion = p.question;
    entryYesProbability = p.yesProbability;
  } else {
    const p = signalRow.payload as MultiPredictionSignal;
    if (!body.marketId) {
      return NextResponse.json(
        { error: "marketId required for multi-outcome events" },
        { status: 400 },
      );
    }
    const outcome = p.outcomes.find((o) => o.marketId === body.marketId);
    if (!outcome) {
      return NextResponse.json(
        { error: "marketId not in signal outcomes" },
        { status: 400 },
      );
    }
    resolvedMarketId = outcome.marketId;
    resolvedOutcomeLabel = body.outcomeLabel ?? outcome.label;
    resolvedQuestion = `${outcome.label} · ${p.question}`;
    entryYesProbability = outcome.yesProbability;
  }

  const payload = { marketId: resolvedMarketId } as { marketId: string };

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json(
      { error: "no Solana wallet on user" },
      { status: 400 },
    );
  }

  const isYes = body.outcome === "yes";
  const depositAtomic = BigInt(Math.floor(body.amountUsdc * 1_000_000));

  // Unify on USDC across all bet paths. If the user is short USDC but
  // their combined USDC + jupUSD covers the trade, ask them to sign a
  // jupUSD->USDC swap first; the client re-calls this endpoint after
  // consolidation confirms.
  try {
    const consolidation = await ensureUsdcOrConsolidate({
      userPubkey: user.solanaPubkey,
      requiredUsd: body.amountUsdc,
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
    console.error("[bet/prediction] consolidation check failed:", err);
  }

  let order;
  try {
    order = await createOrder({
      ownerPubkey: user.solanaPubkey,
      marketId: resolvedMarketId,
      isYes,
      isBuy: true,
      depositAmountMicroUsd: depositAtomic,
    });
  } catch (err) {
    console.error("[bet/prediction] order failed:", err);
    return NextResponse.json(
      { error: `Order build failed: ${String(err)}` },
      { status: 502 },
    );
  }

  if (!order.transaction) {
    return NextResponse.json(
      { error: "Order build returned no transaction" },
      { status: 502 },
    );
  }

  const [bet] = await db
    .insert(bets)
    .values({
      userId: user.id,
      signalId: signalRow.id,
      type: "prediction",
      amountUsdc: body.amountUsdc,
      status: "pending",
      meta: {
        marketId: resolvedMarketId,
        eventId:
          signalRow.type === "prediction"
            ? (signalRow.payload as PredictionSignal).eventId
            : (signalRow.payload as MultiPredictionSignal).eventId,
        outcome: body.outcome,
        outcomeLabel: resolvedOutcomeLabel,
        question: resolvedQuestion,
        entryYesProbability,
        contracts: order.order.contracts,
        avgPriceUsd: order.order.newAvgPriceUsd,
        orderCostUsd: order.order.orderCostUsd,
        positionPubkey: order.order.positionPubkey,
      },
    })
    .returning();

  return NextResponse.json({
    phase: "open",
    betId: bet.id,
    swapTransaction: order.transaction,
    contracts: order.order.contracts,
    avgPriceUsd: order.order.newAvgPriceUsd,
  });
}
