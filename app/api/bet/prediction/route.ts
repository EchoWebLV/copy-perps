import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { signals, bets } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { createOrder } from "@/lib/jupiter-prediction/client";
import type { PredictionSignal } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MIN_USDC = 5;
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

  if (!signalRow || signalRow.type !== "prediction") {
    return NextResponse.json(
      { error: "signal not found or wrong type" },
      { status: 400 },
    );
  }

  const payload = signalRow.payload as PredictionSignal;
  if (!payload.marketId) {
    return NextResponse.json(
      { error: "signal missing marketId" },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json(
      { error: "no Solana wallet on user" },
      { status: 400 },
    );
  }

  const isYes = body.outcome === "yes";
  const depositAtomic = BigInt(Math.floor(body.amountUsdc * 1_000_000));

  let order;
  try {
    order = await createOrder({
      ownerPubkey: user.solanaPubkey,
      marketId: payload.marketId,
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
        marketId: payload.marketId,
        eventId: payload.eventId,
        outcome: body.outcome,
        question: payload.question,
        entryYesProbability: payload.yesProbability,
        contracts: order.order.contracts,
        avgPriceUsd: order.order.newAvgPriceUsd,
        orderCostUsd: order.order.orderCostUsd,
        positionPubkey: order.order.positionPubkey,
      },
    })
    .returning();

  return NextResponse.json({
    betId: bet.id,
    swapTransaction: order.transaction,
    contracts: order.order.contracts,
    avgPriceUsd: order.order.newAvgPriceUsd,
  });
}
