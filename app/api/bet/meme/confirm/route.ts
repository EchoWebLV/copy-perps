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
    actualOutAmount?: string;
    failed?: boolean;
    failureReason?: string;
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

  const newMeta = {
    ...((bet.meta as Record<string, unknown> | null) ?? {}),
    ...(body.actualOutAmount ? { actualOutAmount: body.actualOutAmount } : {}),
    ...(body.failureReason ? { failureReason: body.failureReason } : {}),
    [body.failed ? "failedAt" : "confirmedAt"]: new Date().toISOString(),
  };

  const [updated] = await db
    .update(bets)
    .set({
      txHash: body.txHash ?? null,
      status: body.failed ? "failed" : "confirmed",
      meta: newMeta,
    })
    .where(eq(bets.id, body.betId))
    .returning();

  return NextResponse.json({ ok: true, bet: updated });
}
