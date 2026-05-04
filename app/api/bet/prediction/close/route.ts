import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { closePosition, getPosition } from "@/lib/jupiter-prediction/client";

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

  try {
    // Read position mark-to-market BEFORE building the close. Jupiter's
    // close response sets `orderCostUsd` to the user's spend on the order
    // (zero for sells), which made every closed prediction record proceeds
    // of $0 and display as -100% PnL. The position's `valueUsd` is the
    // current micro-USD value the user gets back at market price — much
    // better proceeds proxy. Falls back to orderCostUsd if the market has
    // already resolved (valueUsd is null in that case).
    const position = await getPosition(positionPubkey).catch(() => null);
    const result = await closePosition(positionPubkey, user.solanaPubkey);
    if (!result.transaction) {
      return NextResponse.json(
        { error: "Close returned no transaction" },
        { status: 502 },
      );
    }
    const expectedProceedsAtomic =
      position?.valueUsd ?? result.order.orderCostUsd;
    return NextResponse.json({
      swapTransaction: result.transaction,
      expectedProceedsAtomic,
    });
  } catch (err) {
    console.error("[bet/prediction/close] failed:", err);
    return NextResponse.json(
      { error: `Close build failed: ${String(err)}` },
      { status: 502 },
    );
  }
}
