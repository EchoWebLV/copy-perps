// Pure PnL math lives in ./pnl.ts now — kept as re-exports here so any
// existing server-side imports keep working. Client components must
// import from ./pnl directly to avoid pulling the db init below.
export {
  computePaperPnlUsd,
  computeLivePaperPnlPct,
  type PaperPnlArgs,
  type LivePaperPnlArgs,
} from "./pnl";

import { db } from "@/lib/db";
import { bots, paperPositions } from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import type { PaperPosition, EntryDecision } from "./types";

function rowToPosition(row: typeof paperPositions.$inferSelect): PaperPosition {
  return {
    id: row.id,
    botId: row.botId,
    asset: row.asset,
    side: row.side as "long" | "short",
    leverage: row.leverage,
    stakeUsd: row.stakeUsd, // NEW
    entryMark: row.entryMark,
    entryTs: row.entryTs,
    exitMark: row.exitMark,
    exitTs: row.exitTs,
    paperPnlUsd: row.paperPnlUsd,
    triggerMeta: (row.triggerMeta as Record<string, unknown> | null) ?? null,
    narrationOpen: row.narrationOpen,
    narrationClose: row.narrationClose,
    status: row.status as "open" | "closed" | "expired",
  };
}

export async function fetchOpenPositions(): Promise<PaperPosition[]> {
  const rows = await db
    .select()
    .from(paperPositions)
    .where(eq(paperPositions.status, "open"));
  return rows.map(rowToPosition);
}

export async function fetchOpenPositionForBot(
  botId: string,
  positionId?: string,
): Promise<PaperPosition | null> {
  const filters = [
    eq(paperPositions.botId, botId),
    eq(paperPositions.status, "open"),
  ];
  if (positionId) filters.push(eq(paperPositions.id, positionId));

  const rows = await db
    .select()
    .from(paperPositions)
    .where(and(...filters))
    .limit(1);
  return rows[0] ? rowToPosition(rows[0]) : null;
}

export async function openPaperPosition(args: {
  botId: string;
  decision: EntryDecision;
  entryMark: number;
  stakeUsd: number; // NEW
  narration: string | null;
}): Promise<PaperPosition> {
  const [row] = await db
    .insert(paperPositions)
    .values({
      botId: args.botId,
      asset: args.decision.asset,
      side: args.decision.side,
      leverage: args.decision.leverage,
      stakeUsd: args.stakeUsd, // NEW
      entryMark: args.entryMark,
      triggerMeta: args.decision.triggerMeta,
      narrationOpen: args.narration,
      status: "open",
    })
    .returning();
  return rowToPosition(row);
}

export async function closePaperPosition(args: {
  positionId: string;
  botId: string; // NEW — needed for balance update
  exitMark: number;
  paperPnlUsd: number;
  narration: string | null;
}): Promise<void> {
  // Update the position
  await db
    .update(paperPositions)
    .set({
      exitMark: args.exitMark,
      exitTs: new Date(),
      paperPnlUsd: args.paperPnlUsd,
      narrationClose: args.narration,
      status: "closed",
    })
    .where(eq(paperPositions.id, args.positionId));

  // Credit the bot's balance with the PnL
  // (Two sequential updates — Neon HTTP doesn't support nested transactions cleanly.)
  await db
    .update(bots)
    .set({
      balanceUsd: sql`${bots.balanceUsd} + ${args.paperPnlUsd}`,
    })
    .where(eq(bots.id, args.botId));
}

/** Returns all open positions for a given bot. Used by the resolver. */
export async function fetchOpenPositionsForBot(
  botId: string,
): Promise<PaperPosition[]> {
  const rows = await db
    .select()
    .from(paperPositions)
    .where(
      and(eq(paperPositions.botId, botId), eq(paperPositions.status, "open")),
    );
  return rows.map(rowToPosition);
}

/** Returns the bot's current paper balance in USD. */
export async function getBotBalance(botId: string): Promise<number> {
  const [row] = await db
    .select({ balance: bots.balanceUsd })
    .from(bots)
    .where(eq(bots.id, botId))
    .limit(1);
  return row?.balance ?? 0;
}

/** Marks a bot as busted (balance <= 0 / blown up). */
export async function markBotBusted(botId: string): Promise<void> {
  await db.update(bots).set({ status: "busted" }).where(eq(bots.id, botId));
}

/**
 * Returns true if the bot's most recent N closed positions all lost
 * money AND the most-recent close happened within `windowMs`. Used as a
 * tilt-prevention gate: after a fast losing streak the strategy is
 * almost certainly fighting the current regime, so the resolver pauses
 * its entries until either time passes or a green close comes in.
 *
 * The window is anchored to the latest close, not "now minus window" —
 * a bot that closed two losers 30s apart at 11:00 stays in cooldown
 * even if you check at 11:04, because the streak is fresh in the bot's
 * recent trade tape. A green close (any positive PnL within the last
 * N) clears the streak naturally.
 */
export async function isInLossCooldown(args: {
  botId: string;
  lossStreakLength: number;
  windowMs: number;
}): Promise<boolean> {
  const rows = await db
    .select({ pnl: paperPositions.paperPnlUsd, exitTs: paperPositions.exitTs })
    .from(paperPositions)
    .where(
      and(
        eq(paperPositions.botId, args.botId),
        eq(paperPositions.status, "closed"),
      ),
    )
    .orderBy(desc(paperPositions.exitTs))
    .limit(args.lossStreakLength);
  if (rows.length < args.lossStreakLength) return false;
  const latestExit = rows[0].exitTs;
  if (!latestExit) return false;
  const ageMs = Date.now() - new Date(latestExit).getTime();
  if (ageMs > args.windowMs) return false;
  return rows.every((r) => (r.pnl ?? 0) < 0);
}

/**
 * Counts the bot's CURRENT consecutive-loss streak — how many of its
 * most-recent closed positions lost money in a row, stopping at the
 * first win. 0 = the last close was green (or the bot has no closed
 * trades). Used by Tilt to martingale its leverage.
 */
export async function getLossStreak(botId: string): Promise<number> {
  const rows = await db
    .select({ pnl: paperPositions.paperPnlUsd })
    .from(paperPositions)
    .where(
      and(
        eq(paperPositions.botId, botId),
        eq(paperPositions.status, "closed"),
      ),
    )
    .orderBy(desc(paperPositions.exitTs))
    .limit(20);
  let streak = 0;
  for (const r of rows) {
    if ((r.pnl ?? 0) < 0) streak += 1;
    else break;
  }
  return streak;
}
