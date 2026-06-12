import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, fills } from "@/lib/db/schema";
import {
  parseFlashTailMeta,
  type FlashTailMeta,
} from "./flash-tail-meta";

export type FlashTailBet = {
  id: string;
  userId: string;
  status: string;
  amountUsdc: number;
  meta: FlashTailMeta;
};

function toFlashTailBet(row: typeof bets.$inferSelect): FlashTailBet | null {
  const meta = parseFlashTailMeta(row.meta);
  if (!meta) return null;
  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    amountUsdc: row.amountUsdc,
    meta,
  };
}

export async function recordFlashTailOpen(args: {
  userId: string;
  stakeUsdc: number;
  meta: FlashTailMeta;
}): Promise<string> {
  const [row] = await db
    .insert(bets)
    .values({
      userId: args.userId,
      type: "flash-tail",
      amountUsdc: args.stakeUsdc,
      status: "pending",
      meta: args.meta,
    })
    .returning();
  if (!row) throw new Error("flash-tail bet insert failed");
  return row.id;
}

async function loadOwnedFlashTailBet(
  betId: string,
  userId: string,
): Promise<FlashTailBet | null> {
  const [row] = await db
    .select()
    .from(bets)
    .where(and(eq(bets.id, betId), eq(bets.userId, userId), eq(bets.type, "flash-tail")))
    .limit(1);
  return row ? toFlashTailBet(row) : null;
}

export async function confirmFlashTailOpen(args: {
  betId: string;
  userId: string;
  signature: string;
}): Promise<boolean> {
  const bet = await loadOwnedFlashTailBet(args.betId, args.userId);
  if (!bet || bet.status !== "pending") return false;

  const nextMeta: FlashTailMeta = { ...bet.meta, openSignature: args.signature };
  // Compare-and-set: the status predicate in the WHERE makes concurrent
  // confirms race-safe — only the call that actually flips the row writes
  // the fill.
  const updated = await db
    .update(bets)
    .set({ status: "confirmed", txHash: args.signature, meta: nextMeta })
    .where(
      and(
        eq(bets.id, args.betId),
        eq(bets.userId, args.userId),
        eq(bets.status, "pending"),
      ),
    )
    .returning();
  if (updated.length === 0) return false;

  await db
    .insert(fills)
    .values({
      betId: args.betId,
      action: "open",
      market: bet.meta.market,
      side: bet.meta.side,
      fillUsd: bet.meta.notionalUsd,
      priceUsd: bet.meta.entryPriceUsd,
      feeUsd: bet.meta.openFeeUsd,
      txSig: args.signature,
      source: "quote-estimate",
    })
    .onConflictDoNothing();
  return true;
}

export async function confirmFlashTailClose(args: {
  betId: string;
  userId: string;
  signature: string;
  receiveUsdEstimate: number | null;
  /** Who initiated the close. Defaults to 'manual' (user-clicked). The copy
   *  engine stamps 'source-closed'; 'external' marks bookkeeping-only closes
   *  where the position was already gone on-chain. */
  closeReason?: "manual" | "source-closed" | "external";
}): Promise<boolean> {
  const bet = await loadOwnedFlashTailBet(args.betId, args.userId);
  if (!bet || bet.status !== "confirmed") return false;

  const nextMeta: FlashTailMeta = {
    ...bet.meta,
    closeSignature: args.signature,
    closeReason: args.closeReason ?? "manual",
    proceedsSource: "quote-estimate",
  };
  const updated = await db
    .update(bets)
    .set({
      status: "closed",
      closedAt: new Date(),
      closeTxHash: args.signature,
      proceedsUsdc: args.receiveUsdEstimate,
      meta: nextMeta,
    })
    .where(
      and(
        eq(bets.id, args.betId),
        eq(bets.userId, args.userId),
        eq(bets.status, "confirmed"),
      ),
    )
    .returning();
  if (updated.length === 0) return false;

  await db
    .insert(fills)
    .values({
      betId: args.betId,
      action: "close",
      market: bet.meta.market,
      side: bet.meta.side,
      fillUsd: args.receiveUsdEstimate,
      priceUsd: null,
      feeUsd: null,
      txSig: args.signature,
      source: "quote-estimate",
    })
    .onConflictDoNothing();
  return true;
}

/**
 * Newest confirmed flash-tail bet for (user, market, side). Flash holds one
 * position per (owner, market, side), so this maps a live on-chain position
 * back to the bet that opened it.
 */
export async function findOpenFlashTailBet(args: {
  userId: string;
  market: string;
  side: "long" | "short";
}): Promise<FlashTailBet | null> {
  const rows = await db
    .select()
    .from(bets)
    .where(
      and(
        eq(bets.userId, args.userId),
        eq(bets.type, "flash-tail"),
        eq(bets.status, "confirmed"),
        sql`${bets.meta} ->> 'market' = ${args.market}`,
        sql`${bets.meta} ->> 'side' = ${args.side}`,
      ),
    )
    .orderBy(desc(bets.createdAt))
    .limit(1);
  const row = rows[0];
  return row ? toFlashTailBet(row) : null;
}
