import { NextResponse } from "next/server";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { enrichBet } from "@/lib/positions/enrich";
import { getPositions } from "@/lib/pacifica/client";

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

  // --- Pacifica copy bets ---
  const copyBets = userBets.filter((b) => b.type === "copy");
  let userPositions = null;
  if (copyBets.length > 0 && user.solanaPubkey) {
    try {
      userPositions = await getPositions(user.solanaPubkey);
    } catch (err) {
      console.warn("[portfolio] pacifica positions fetch failed:", err);
    }
  }
  const copyRows = copyBets
    .filter((b) => b.status === "confirmed")
    .map((b) => {
      const meta = b.meta as {
        leaderMarket: string;
        leaderSide: "long" | "short";
        leverage: number;
        leaderAddress: string;
        leaderClosedAt?: string;
      };
      const livePos = userPositions?.find(
        (p) =>
          p.symbol === meta.leaderMarket &&
          ((meta.leaderSide === "long" && p.side === "bid") ||
            (meta.leaderSide === "short" && p.side === "ask")),
      );
      void livePos; // referenced for future PnL; intentionally unused now
      return {
        betId: b.id,
        market: meta.leaderMarket,
        side: meta.leaderSide,
        leverage: meta.leverage,
        stakeUsdc: b.amountUsdc,
        leaderAddress: meta.leaderAddress,
        leaderUsername: null,
        // Pacifica's /positions does not expose unrealized PnL%; null in
        // Phase 1 (computed via WS mark in Phase 2).
        unrealizedPnlPct: null,
        leaderClosedAt: meta.leaderClosedAt ?? null,
      };
    });

  return NextResponse.json({ positions, copyRows });
}
