// lib/copy/store.ts
//
// DB access for the copy engine and the /api/copy routes. Money state
// lives in bets rows (type 'flash-tail'); this module only reads them for
// dedup/caps and owns the copy_subscriptions instructions table.

import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, copySubscriptions, users } from "@/lib/db/schema";
import { parseFlashTailMeta, type FlashTailMeta } from "@/lib/bets/flash-tail-meta";
import type { CopyTargetKind } from "./types";

export interface CopySubscriptionRow {
  id: string;
  userId: string;
  privyUserId: string;
  walletAddress: string;
  targetKind: CopyTargetKind;
  targetKey: string;
  targetLabel: string | null;
  stakeUsdc: number;
  leverageMode: "mirror" | "fixed";
  fixedLeverage: number | null;
  autoClose: boolean;
  maxConcurrent: number;
  dailyCapUsd: number;
  maxEntryGapBps: number;
  status: "active" | "paused" | "stopped";
  createdAt: Date;
  lastCopyAt: Date | null;
}

function toSubscriptionRow(row: {
  sub: typeof copySubscriptions.$inferSelect;
  privyId: string;
  solanaPubkey: string | null;
}): CopySubscriptionRow | null {
  if (!row.solanaPubkey) return null; // no wallet → cannot execute
  if (
    row.sub.targetKind !== "arena-bot" &&
    row.sub.targetKind !== "flash-wallet" &&
    row.sub.targetKind !== "whale"
  ) {
    return null;
  }
  return {
    id: row.sub.id,
    userId: row.sub.userId,
    privyUserId: row.privyId,
    walletAddress: row.solanaPubkey,
    targetKind: row.sub.targetKind,
    targetKey: row.sub.targetKey,
    targetLabel: row.sub.targetLabel,
    stakeUsdc: row.sub.stakeUsdc,
    leverageMode: row.sub.leverageMode === "fixed" ? "fixed" : "mirror",
    fixedLeverage: row.sub.fixedLeverage,
    autoClose: row.sub.autoClose,
    maxConcurrent: row.sub.maxConcurrent,
    dailyCapUsd: row.sub.dailyCapUsd,
    maxEntryGapBps: row.sub.maxEntryGapBps,
    status:
      row.sub.status === "paused" || row.sub.status === "stopped"
        ? row.sub.status
        : "active",
    createdAt: row.sub.createdAt,
    lastCopyAt: row.sub.lastCopyAt,
  };
}

/** Subscriptions the open pass acts on (active only; paused subs keep
 *  their close pass via the bets meta flag, which needs no subscription). */
export async function listActiveCopySubscriptions(): Promise<
  CopySubscriptionRow[]
> {
  const rows = await db
    .select({
      sub: copySubscriptions,
      privyId: users.privyId,
      solanaPubkey: users.solanaPubkey,
    })
    .from(copySubscriptions)
    .innerJoin(users, eq(users.id, copySubscriptions.userId))
    .where(eq(copySubscriptions.status, "active"));
  return rows
    .map(toSubscriptionRow)
    .filter((row): row is CopySubscriptionRow => row !== null);
}

export interface AutoCloseBetRow {
  betId: string;
  userId: string;
  privyUserId: string;
  meta: FlashTailMeta;
}

/** Open flash-tail bets that opted into source-close (subscription copies
 *  and checkbox manual tails alike). */
export async function listOpenAutoCloseBets(): Promise<AutoCloseBetRow[]> {
  const rows = await db
    .select({
      betId: bets.id,
      userId: bets.userId,
      meta: bets.meta,
      privyId: users.privyId,
    })
    .from(bets)
    .innerJoin(users, eq(users.id, bets.userId))
    .where(
      and(
        eq(bets.type, "flash-tail"),
        eq(bets.status, "confirmed"),
        sql`${bets.meta} ->> 'autoCloseOnSourceClose' = 'true'`,
      ),
    );
  const out: AutoCloseBetRow[] = [];
  for (const row of rows) {
    const meta = parseFlashTailMeta(row.meta);
    if (!meta) continue;
    out.push({
      betId: row.betId,
      userId: row.userId,
      privyUserId: row.privyId,
      meta,
    });
  }
  return out;
}

/** Cross-restart dedup: has this subscription ever attempted this source
 *  position (any bet status — a failed/abandoned attempt still counts)? */
export async function hasCopiedSourcePosition(
  subscriptionId: string,
  sourcePositionId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: bets.id })
    .from(bets)
    .where(
      and(
        eq(bets.type, "flash-tail"),
        sql`${bets.meta} ->> 'copySubscriptionId' = ${subscriptionId}`,
        sql`${bets.meta} ->> 'sourcePositionId' = ${sourcePositionId}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function countOpenCopies(subscriptionId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bets)
    .where(
      and(
        eq(bets.type, "flash-tail"),
        eq(bets.status, "confirmed"),
        sql`${bets.meta} ->> 'copySubscriptionId' = ${subscriptionId}`,
      ),
    );
  return rows[0]?.count ?? 0;
}

/** Rolling 24h spend for the daily cap (stricter than calendar-day resets). */
export async function spentLast24hUsd(subscriptionId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${bets.amountUsdc}), 0)::float` })
    .from(bets)
    .where(
      and(
        eq(bets.type, "flash-tail"),
        ne(bets.status, "abandoned"),
        gte(bets.createdAt, since),
        sql`${bets.meta} ->> 'copySubscriptionId' = ${subscriptionId}`,
      ),
    );
  return rows[0]?.total ?? 0;
}

export async function touchLastCopy(subscriptionId: string): Promise<void> {
  await db
    .update(copySubscriptions)
    .set({ lastCopyAt: new Date() })
    .where(eq(copySubscriptions.id, subscriptionId));
}

// ───────────────────────── route-facing CRUD ───────────────────────────────

export interface CreateCopySubscriptionArgs {
  userId: string;
  targetKind: CopyTargetKind;
  targetKey: string;
  targetLabel: string | null;
  stakeUsdc: number;
  leverageMode: "mirror" | "fixed";
  fixedLeverage: number | null;
  autoClose: boolean;
  maxConcurrent: number;
  dailyCapUsd: number;
  maxEntryGapBps: number;
}

export async function createCopySubscription(
  args: CreateCopySubscriptionArgs,
): Promise<typeof copySubscriptions.$inferSelect> {
  const [row] = await db
    .insert(copySubscriptions)
    .values({
      userId: args.userId,
      targetKind: args.targetKind,
      targetKey: args.targetKey,
      targetLabel: args.targetLabel,
      stakeUsdc: args.stakeUsdc,
      leverageMode: args.leverageMode,
      fixedLeverage: args.fixedLeverage,
      autoClose: args.autoClose,
      maxConcurrent: args.maxConcurrent,
      dailyCapUsd: args.dailyCapUsd,
      maxEntryGapBps: args.maxEntryGapBps,
    })
    .returning();
  if (!row) throw new Error("copy subscription insert failed");
  return row;
}

export async function listUserCopySubscriptions(userId: string) {
  return db
    .select()
    .from(copySubscriptions)
    .where(
      and(
        eq(copySubscriptions.userId, userId),
        ne(copySubscriptions.status, "stopped"),
      ),
    )
    .orderBy(desc(copySubscriptions.createdAt));
}

export async function setCopySubscriptionStatus(args: {
  id: string;
  userId: string;
  status: "active" | "paused" | "stopped";
}): Promise<boolean> {
  const rows = await db
    .update(copySubscriptions)
    .set({ status: args.status })
    .where(
      and(
        eq(copySubscriptions.id, args.id),
        eq(copySubscriptions.userId, args.userId),
        ne(copySubscriptions.status, "stopped"),
      ),
    )
    .returning({ id: copySubscriptions.id });
  return rows.length > 0;
}
