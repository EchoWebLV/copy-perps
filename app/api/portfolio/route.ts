import { NextResponse } from "next/server";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { enrichBet } from "@/lib/positions/enrich";

const STALE_PENDING_MS = 5 * 60 * 1000;

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.privyId, claims.userId))
    .limit(1);
  if (!user) return NextResponse.json({ positions: [] });

  // Reap pending bets that never reached the confirm step (sign cancelled,
  // wallet modal closed, network died mid-sign, etc.) so they don't clutter
  // the portfolio forever.
  const staleCutoff = new Date(Date.now() - STALE_PENDING_MS);
  await db
    .update(bets)
    .set({ status: "abandoned" })
    .where(
      and(
        eq(bets.userId, user.id),
        eq(bets.status, "pending"),
        lt(bets.createdAt, staleCutoff),
      ),
    );

  const userBets = await db
    .select()
    .from(bets)
    .where(
      and(
        eq(bets.userId, user.id),
        inArray(bets.status, ["pending", "confirmed", "closed"]),
      ),
    )
    .orderBy(desc(bets.createdAt));

  const positions = await Promise.all(
    userBets.map((bet) => enrichBet(bet, user.solanaPubkey)),
  );

  return NextResponse.json({ positions });
}
