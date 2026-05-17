import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets } from "@/lib/db/schema";

/**
 * True if the user already holds an open (confirmed) copy tail on `market`.
 *
 * Pacifica nets positions by (account, symbol): a second tail on the same
 * market merges into one on-chain position, so closing or auto-closing one
 * tail would close the other too and misattribute its realized PnL. We
 * therefore allow only one open tail per (user, market) — callers reject a
 * second open.
 */
export async function hasOpenTailOnMarket(
  userId: string,
  market: string,
): Promise<boolean> {
  const rows = await db
    .select({ meta: bets.meta })
    .from(bets)
    .where(
      and(
        eq(bets.userId, userId),
        eq(bets.type, "copy"),
        eq(bets.status, "confirmed"),
      ),
    );
  return rows.some(
    (r) =>
      (r.meta as { leaderMarket?: string } | null)?.leaderMarket === market,
  );
}
