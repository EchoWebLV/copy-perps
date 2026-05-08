import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/share { betId } — publish to leaderboard
// DELETE /api/share { betId } — unpublish
//
// A share is just a non-null `bets.sharedAt`. Status of the underlying
// bet drives whether the leaderboard renders the card as live or final,
// so a user can share an open position now and the card transitions to
// final automatically once they close it.

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { betId } = (await request.json().catch(() => ({}))) as {
    betId?: string;
  };
  if (!betId) {
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
    .where(and(eq(bets.id, betId), eq(bets.userId, user.id)))
    .limit(1);
  if (!bet) {
    return NextResponse.json({ error: "bet not found" }, { status: 404 });
  }

  // Only confirmed (live) and closed (final) bets are shareable. Pending,
  // failed, and abandoned bets aren't real positions.
  if (!["confirmed", "closed"].includes(bet.status)) {
    return NextResponse.json(
      { error: "only confirmed or closed positions can be shared" },
      { status: 400 },
    );
  }

  const sharedAt = new Date();
  await db.update(bets).set({ sharedAt }).where(eq(bets.id, bet.id));

  return NextResponse.json({ ok: true, sharedAt: sharedAt.toISOString() });
}

export async function DELETE(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { betId } = (await request.json().catch(() => ({}))) as {
    betId?: string;
  };
  if (!betId) {
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

  await db
    .update(bets)
    .set({ sharedAt: null })
    .where(
      and(
        eq(bets.id, betId),
        eq(bets.userId, user.id),
        inArray(bets.status, ["confirmed", "closed"]),
      ),
    );

  return NextResponse.json({ ok: true });
}
