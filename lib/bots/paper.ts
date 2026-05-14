export interface PaperPnlArgs {
  side: "long" | "short";
  leverage: number;
  entryMark: number;
  exitMark: number;
  stakeUsd: number;
}

/**
 * Realized paper PnL in USD at exit. Pass the *stake* (margin) not notional —
 * notional is computed inside as stake × leverage so high-leverage bots
 * earn proportionally bigger absolute paper PnL per same price move, which
 * is what the leaderboard ranking needs for cross-bot comparability.
 * Sign convention: positive = profit.
 */
export function computePaperPnlUsd(args: PaperPnlArgs): number {
  const { side, leverage, entryMark, exitMark, stakeUsd } = args;
  const moveFrac = (exitMark - entryMark) / entryMark;
  const directional = side === "long" ? moveFrac : -moveFrac;
  return stakeUsd * leverage * directional;
}

export interface LivePaperPnlArgs {
  side: "long" | "short";
  leverage: number;
  entryMark: number;
  currentMark: number;
}

/**
 * Unrealized paper PnL as a fraction of stake (not notional). At leverage L
 * and price move M%, this returns L*M (e.g. 5x with +10% move = +50%).
 */
export function computeLivePaperPnlPct(args: LivePaperPnlArgs): number {
  const { side, leverage, entryMark, currentMark } = args;
  const moveFrac = (currentMark - entryMark) / entryMark;
  const directional = side === "long" ? moveFrac : -moveFrac;
  return directional * leverage;
}

// lib/bots/paper.ts (append)
import { db } from "@/lib/db";
import { bots, paperPositions } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
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
): Promise<PaperPosition | null> {
  const rows = await db
    .select()
    .from(paperPositions)
    .where(
      and(eq(paperPositions.botId, botId), eq(paperPositions.status, "open")),
    )
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
