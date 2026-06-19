import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets } from "@/lib/db/schema";
import { copyMetaVenue, type CopyMetaVenue } from "./copy-meta";

const BLOCKING_COPY_STATUSES = ["confirmed", "pending", "manual_review"];

/**
 * True if the user already holds an open or unresolved copy tail on `market`
 * *on the given venue*.
 *
 * Each venue nets positions by (account, symbol): a second tail on the same
 * market+venue merges into one on-chain position, so closing or auto-closing
 * one tail would close the other too and misattribute its realized PnL. We
 * therefore allow only one open tail per (user, market, venue) — callers reject
 * a second open. A Pacifica tail and a Flash v2 tail on the same market are
 * independent on-chain positions, so they don't block each other. `venue`
 * defaults to 'pacifica'; legacy rows with no `meta.venue` count as Pacifica.
 */
export async function hasOpenTailOnMarket(
  userId: string,
  market: string,
  venue: CopyMetaVenue = "pacifica",
): Promise<boolean> {
  const rows = await db
    .select({ status: bets.status, meta: bets.meta })
    .from(bets)
    .where(
      and(
        eq(bets.userId, userId),
        eq(bets.type, "copy"),
        inArray(bets.status, BLOCKING_COPY_STATUSES),
      ),
    );
  return rows.some(
    (r) =>
      BLOCKING_COPY_STATUSES.includes(r.status) &&
      (r.meta as { leaderMarket?: string } | null)?.leaderMarket === market &&
      copyMetaVenue(r.meta) === venue,
  );
}
