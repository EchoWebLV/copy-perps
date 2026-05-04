import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import {
  getPosition,
  sellPositionToMint,
} from "@/lib/jupiter-prediction/client";
import { USDC_MINT } from "@/lib/jupiter/constants";

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
  const positionPubkey = meta.positionPubkey as string | undefined;
  if (!positionPubkey) {
    return NextResponse.json(
      { error: "bet missing positionPubkey" },
      { status: 400 },
    );
  }

  // Experimental close path: POST /orders with depositMint=USDC instead of
  // DELETE /positions/{pk}. If Jupiter honors depositMint as the proceeds
  // mint for sells, the user receives USDC directly and we skip a
  // follow-up jupUSD->USDC swap. If the API ignores depositMint on sells,
  // we'll see jupUSD in the close tx logs and revert to DELETE.
  try {
    const position = await getPosition(positionPubkey);
    if (!position) {
      return NextResponse.json(
        { error: "position not found on chain" },
        { status: 404 },
      );
    }
    const result = await sellPositionToMint({
      ownerPubkey: user.solanaPubkey,
      positionPubkey,
      isYes: position.isYes,
      contracts: position.contracts,
      receiveMint: USDC_MINT,
    });
    if (!result.transaction) {
      return NextResponse.json(
        { error: "Sell-order returned no transaction" },
        { status: 502 },
      );
    }
    return NextResponse.json({
      swapTransaction: result.transaction,
      expectedProceedsAtomic: result.order.orderCostUsd,
    });
  } catch (err) {
    console.error("[bet/prediction/close] failed:", err);
    return NextResponse.json(
      { error: `Close build failed: ${String(err)}` },
      { status: 502 },
    );
  }
}
