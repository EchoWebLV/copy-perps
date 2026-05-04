import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    betId?: string;
    txHash?: string;
    proceedsAtomic?: string;
  } | null;
  if (!body?.betId) {
    return NextResponse.json({ error: "betId required" }, { status: 400 });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.privyId, claims.userId))
    .limit(1);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const [bet] = await db
    .select()
    .from(bets)
    .where(and(eq(bets.id, body.betId), eq(bets.userId, user.id)))
    .limit(1);
  if (!bet) {
    return NextResponse.json({ error: "bet not found" }, { status: 404 });
  }

  const proceedsUsdc = body.proceedsAtomic
    ? Number(body.proceedsAtomic) / 1_000_000
    : null;

  const newMeta = {
    ...((bet.meta as Record<string, unknown> | null) ?? {}),
    closedAt: new Date().toISOString(),
  };

  await db
    .update(bets)
    .set({
      status: "closed",
      closedAt: new Date(),
      closeTxHash: body.txHash ?? null,
      proceedsUsdc,
      meta: newMeta,
    })
    .where(eq(bets.id, body.betId));

  return NextResponse.json({ ok: true });
}
