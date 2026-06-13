// Whale-level Bullish/Bearish sentiment: a vote attaches to the WHALE and
// persists across position churn (unlike the per-position pulse reactions).
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { whaleReactions } from "@/lib/db/schema";

export type WhaleReactionKind = "Bullish" | "Bearish";

export interface WhaleSentiment {
  bullish: number;
  bearish: number;
  myReaction: WhaleReactionKind | null;
}

export function normalizeWhaleReaction(value: unknown): WhaleReactionKind | null {
  return value === "Bullish" || value === "Bearish" ? value : null;
}

const MAX_WHALE_IDS = 200;

/** Aggregate counts (+ the caller's own vote when userId is given) for each
 *  requested whale. Whales with no votes come back as zeros. */
export async function getWhaleReactions(args: {
  whaleIds: string[];
  userId: string | null;
}): Promise<Record<string, WhaleSentiment>> {
  const ids = [...new Set(args.whaleIds.filter(Boolean))].slice(0, MAX_WHALE_IDS);
  const out: Record<string, WhaleSentiment> = {};
  for (const id of ids) out[id] = { bullish: 0, bearish: 0, myReaction: null };
  if (ids.length === 0) return out;

  const counts = await db
    .select({
      whaleId: whaleReactions.whaleId,
      reaction: whaleReactions.reaction,
      count: sql<number>`count(*)::int`,
    })
    .from(whaleReactions)
    .where(inArray(whaleReactions.whaleId, ids))
    .groupBy(whaleReactions.whaleId, whaleReactions.reaction);

  for (const row of counts) {
    const s = out[row.whaleId];
    if (!s) continue;
    if (row.reaction === "Bullish") s.bullish = row.count;
    else if (row.reaction === "Bearish") s.bearish = row.count;
  }

  if (args.userId) {
    const mine = await db
      .select({
        whaleId: whaleReactions.whaleId,
        reaction: whaleReactions.reaction,
      })
      .from(whaleReactions)
      .where(
        and(
          inArray(whaleReactions.whaleId, ids),
          eq(whaleReactions.userId, args.userId),
        ),
      );
    for (const row of mine) {
      const s = out[row.whaleId];
      if (s) s.myReaction = normalizeWhaleReaction(row.reaction);
    }
  }

  return out;
}

/** Set (or clear, when reaction is null) the user's vote for a whale.
 *  One row per (whale, user) — re-voting replaces, same value clears. */
export async function setWhaleReaction(args: {
  whaleId: string;
  userId: string;
  reaction: WhaleReactionKind | null;
}): Promise<void> {
  if (args.reaction === null) {
    await db
      .delete(whaleReactions)
      .where(
        and(
          eq(whaleReactions.whaleId, args.whaleId),
          eq(whaleReactions.userId, args.userId),
        ),
      );
    return;
  }

  await db
    .insert(whaleReactions)
    .values({
      whaleId: args.whaleId,
      userId: args.userId,
      reaction: args.reaction,
    })
    .onConflictDoUpdate({
      target: [whaleReactions.whaleId, whaleReactions.userId],
      set: { reaction: args.reaction, updatedAt: new Date() },
    });
}
