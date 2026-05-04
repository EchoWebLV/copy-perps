import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { PublicKey } from "@solana/web3.js";
import { db } from "@/lib/db";
import { signals, bets } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { perpMarketIndexFor } from "@/lib/drift/client";
import { buildOpenPerpTx } from "@/lib/drift/perp";
import type { WhaleSignal } from "@/lib/types";

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
    action?: "tail" | "fade";
    amountUsdc?: number;
    walletAddress?: string;
  } | null;

  if (
    !body?.signalId ||
    (body.action !== "tail" && body.action !== "fade") ||
    typeof body.amountUsdc !== "number"
  ) {
    return NextResponse.json(
      { error: "signalId, action (tail|fade), amountUsdc required" },
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

  if (!signalRow || signalRow.type !== "whale") {
    return NextResponse.json(
      { error: "signal not found or wrong type" },
      { status: 400 },
    );
  }

  const whale = signalRow.payload as WhaleSignal;
  const marketIndex = perpMarketIndexFor(whale.asset);
  if (marketIndex == null) {
    return NextResponse.json(
      { error: `${whale.asset} not yet supported on Drift (MVP: SOL/BTC/ETH only)` },
      { status: 400 },
    );
  }

  const direction: "long" | "short" =
    body.action === "tail"
      ? whale.side
      : whale.side === "long"
        ? "short"
        : "long";

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json(
      { error: "no Solana wallet on user" },
      { status: 400 },
    );
  }

  let tx;
  try {
    tx = await buildOpenPerpTx({
      userPubkey: new PublicKey(user.solanaPubkey),
      asset: whale.asset,
      marketIndex,
      direction,
      marginUsdc: body.amountUsdc,
      whaleLeverage: whale.leverage,
    });
  } catch (err) {
    console.error("[bet/perp] build failed:", err);
    return NextResponse.json(
      { error: `Drift tx build failed: ${String(err)}` },
      { status: 502 },
    );
  }

  const [bet] = await db
    .insert(bets)
    .values({
      userId: user.id,
      signalId: signalRow.id,
      type: "perp",
      amountUsdc: body.amountUsdc,
      status: "pending",
      meta: {
        venue: "Drift",
        whaleAddress: whale.walletAddress,
        whaleAsset: whale.asset,
        whaleSide: whale.side,
        whaleLeverage: whale.leverage,
        action: body.action,
        direction,
        marketIndex,
        baseAssetAmount: tx.baseAssetAmount,
        notionalUsd: tx.notionalUsd,
        wasFirstTimeUser: tx.isFirstTimeUser,
      },
    })
    .returning();

  return NextResponse.json({
    betId: bet.id,
    swapTransaction: tx.transaction,
    notionalUsd: tx.notionalUsd,
    direction: tx.direction,
    isFirstTimeUser: tx.isFirstTimeUser,
  });
}
