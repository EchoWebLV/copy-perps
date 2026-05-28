import { NextResponse } from "next/server";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { enrichBet } from "@/lib/positions/enrich";
import {
  buildPortfolioSummary,
  emptyPortfolioPayload,
  type PortfolioSnapshotPayload,
} from "@/lib/positions/portfolio-snapshot";
import { loadPortfolioSnapshotForUser } from "@/lib/positions/portfolio-snapshot-store";

const STALE_PENDING_MS = 5 * 60 * 1000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fallbackPayloadForUser(
  userId: string,
  userPubkey: string | null,
): Promise<PortfolioSnapshotPayload> {
  const staleCutoff = new Date(Date.now() - STALE_PENDING_MS);
  await db
    .update(bets)
    .set({ status: "abandoned" })
    .where(
      and(
        eq(bets.userId, userId),
        eq(bets.status, "pending"),
        lt(bets.createdAt, staleCutoff),
      ),
    );

  const userBets = await db
    .select()
    .from(bets)
    .where(
      and(
        eq(bets.userId, userId),
        inArray(bets.status, ["pending", "confirmed", "closed"]),
      ),
    )
    .orderBy(desc(bets.createdAt));
  const positions = await Promise.all(
    userBets.map((bet) => enrichBet(bet, userPubkey)),
  );

  return {
    positions,
    copyRows: [],
    pacificaAccount: null,
    walletBalance: null,
  };
}

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
  if (!user) {
    const payload = emptyPortfolioPayload();
    const result = {
      payload,
      summary: buildPortfolioSummary(payload),
      snapshot: {
        source: "fallback",
        status: "empty",
        updatedAt: null,
        staleReason: null,
      },
    } as const;
    return NextResponse.json({
      ...result.payload,
      ...result,
    });
  }

  const cached = await loadPortfolioSnapshotForUser(user.id);
  if (cached) {
    return NextResponse.json({
      ...cached.payload,
      ...cached,
    });
  }

  const payload = await fallbackPayloadForUser(user.id, user.solanaPubkey);
  const result = {
    payload,
    summary: buildPortfolioSummary(payload),
    snapshot: {
      source: "fallback",
      status: "empty",
      updatedAt: null,
      staleReason: null,
    },
  } as const;
  return NextResponse.json({
    ...result.payload,
    ...result,
  });
}
