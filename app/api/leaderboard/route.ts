import { NextResponse } from "next/server";
import { desc, eq, inArray, isNotNull, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, users } from "@/lib/db/schema";
import { enrichBet, type EnrichedPosition } from "@/lib/positions/enrich";
import { handleFromPubkey } from "@/lib/users/handle";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const LIMIT = 50;

export interface LeaderboardCard extends EnrichedPosition {
  // Public-safe author fields. We never expose the privy id or full
  // wallet here; just a derived shortcode and a truncated pubkey for
  // social plausibility.
  authorHandle: string;
  authorPubkey: string | null;
}

export async function GET() {
  const rows = await db
    .select({
      bet: bets,
      pubkey: users.solanaPubkey,
    })
    .from(bets)
    .innerJoin(users, eq(users.id, bets.userId))
    .where(
      and(
        isNotNull(bets.sharedAt),
        // Only confirmed (live) and closed (final) cards are renderable.
        // Pending/failed/abandoned would slip through if a user shared a
        // bet that later got reaped — filter explicitly.
        inArray(bets.status, ["confirmed", "closed"]),
      ),
    )
    .orderBy(desc(bets.sharedAt))
    .limit(LIMIT);

  const cards: LeaderboardCard[] = await Promise.all(
    rows.map(async ({ bet, pubkey }) => {
      const enriched = await enrichBet(bet, pubkey);
      return {
        ...enriched,
        authorHandle: handleFromPubkey(pubkey),
        authorPubkey: pubkey,
      };
    }),
  );

  return NextResponse.json({ cards });
}
