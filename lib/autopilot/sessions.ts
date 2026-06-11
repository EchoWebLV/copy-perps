// lib/autopilot/sessions.ts
//
// DB layer for autopilot sessions. The bets rows ARE the trade ledger
// (type 'flash-tail', meta.autopilotSessionId = session id); the session
// row carries the budget/tier/status and an opportunistic realizedPnlUsd
// cache that sessionStats() recomputes from bets every time it runs.
//
// Conservative accounting: a closed bet with unknown proceeds (a
// 'closed-external' row the reconcile sweep hasn't chain-priced yet —
// e.g. an SL trigger fired) counts as a FULL loss of its stake, so the
// loss budget can only be over-protected, never over-spent.

import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { autopilotSessions, bets, users } from "@/lib/db/schema";
import { parseFlashTailMeta } from "@/lib/bets/flash-tail-meta";
import { isTierName, type TierName } from "./tiers";

export const MIN_BUDGET_USD = 5;
export const MAX_BUDGET_USD = 200;

export type AutopilotSessionStatus =
  | "active"
  | "stopped"
  | "exhausted"
  | "target";

export interface AutopilotSession {
  id: string;
  userId: string;
  budgetUsd: number;
  tier: TierName;
  status: AutopilotSessionStatus;
  realizedPnlUsd: number;
  startedAt: Date;
  endedAt: Date | null;
  lastTickAt: Date | null;
}

export interface ActiveSessionWithIdentity extends AutopilotSession {
  /** users.privyId — the DID privyServer.getUserById signs with. */
  privyUserId: string | null;
  /** users.solanaPubkey — the trader wallet. */
  walletAddress: string | null;
}

export interface OpenAutopilotBet {
  betId: string;
  market: string;
  side: "long" | "short";
  stakeUsdc: number;
  leverage: number;
  entryPriceUsd: number | null;
  createdAt: Date;
}

export interface ClosedAutopilotResult {
  pnlUsd: number;
  closedAt: Date;
}

export interface SessionStats {
  realizedPnlUsd: number;
  closedCount: number;
  openBets: OpenAutopilotBet[];
}

export class AutopilotSessionError extends Error {
  constructor(
    public readonly code:
      | "active-session-exists"
      | "invalid-tier"
      | "invalid-budget",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AutopilotSessionError";
  }
}

function toSession(
  row: typeof autopilotSessions.$inferSelect,
): AutopilotSession {
  return {
    id: row.id,
    userId: row.userId,
    budgetUsd: row.budgetUsd,
    tier: isTierName(row.tier) ? row.tier : "cruise",
    status: row.status as AutopilotSessionStatus,
    realizedPnlUsd: row.realizedPnlUsd,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    lastTickAt: row.lastTickAt,
  };
}

export function clampBudget(budgetUsd: number): number {
  if (!Number.isFinite(budgetUsd)) {
    throw new AutopilotSessionError("invalid-budget", "budget must be a number");
  }
  const clamped = Math.min(MAX_BUDGET_USD, Math.max(MIN_BUDGET_USD, budgetUsd));
  return Math.floor(clamped * 100) / 100;
}

export async function startSession(args: {
  userId: string;
  budgetUsd: number;
  tier: string;
}): Promise<AutopilotSession> {
  if (!isTierName(args.tier)) {
    throw new AutopilotSessionError("invalid-tier", "tier must be cruise, sweat, or degen");
  }
  const budgetUsd = clampBudget(args.budgetUsd);
  const existing = await getActiveSession(args.userId);
  if (existing) {
    throw new AutopilotSessionError(
      "active-session-exists",
      "An autopilot session is already running. Stop it first.",
    );
  }
  const [row] = await db
    .insert(autopilotSessions)
    .values({
      userId: args.userId,
      budgetUsd,
      tier: args.tier,
      status: "active",
    })
    .returning();
  if (!row) throw new Error("autopilot session insert failed");
  return toSession(row);
}

/** CAS active -> stopped. Returns null if no active session matched. */
export async function stopSession(args: {
  sessionId: string;
  userId: string;
}): Promise<AutopilotSession | null> {
  const [row] = await db
    .update(autopilotSessions)
    .set({ status: "stopped", endedAt: new Date() })
    .where(
      and(
        eq(autopilotSessions.id, args.sessionId),
        eq(autopilotSessions.userId, args.userId),
        eq(autopilotSessions.status, "active"),
      ),
    )
    .returning();
  return row ? toSession(row) : null;
}

/** Engine-only: CAS active -> exhausted | target. */
export async function endSession(args: {
  sessionId: string;
  status: "exhausted" | "target";
}): Promise<void> {
  await db
    .update(autopilotSessions)
    .set({ status: args.status, endedAt: new Date() })
    .where(
      and(
        eq(autopilotSessions.id, args.sessionId),
        eq(autopilotSessions.status, "active"),
      ),
    );
}

// A holder whose lease expired mid-tick (180s TTL) can overlap the new
// holder's tick; this CAS makes the overlap harmless — only one process
// claims a session per window, so double-opens cannot happen.
export const TICK_CLAIM_GAP_MS = 30_000;

/** CAS tick claim: stamps lastTickAt now IFF no one ticked this active
 * session within the claim window. False = skip the session this tick. */
export async function claimSessionTick(sessionId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - TICK_CLAIM_GAP_MS);
  const rows = await db
    .update(autopilotSessions)
    .set({ lastTickAt: new Date() })
    .where(
      and(
        eq(autopilotSessions.id, sessionId),
        eq(autopilotSessions.status, "active"),
        or(
          isNull(autopilotSessions.lastTickAt),
          lt(autopilotSessions.lastTickAt, cutoff),
        ),
      ),
    )
    .returning();
  return rows.length > 0;
}

export async function touchSession(sessionId: string): Promise<void> {
  await db
    .update(autopilotSessions)
    .set({ lastTickAt: new Date() })
    .where(eq(autopilotSessions.id, sessionId));
}

export async function getActiveSession(
  userId: string,
): Promise<AutopilotSession | null> {
  const [row] = await db
    .select()
    .from(autopilotSessions)
    .where(
      and(
        eq(autopilotSessions.userId, userId),
        eq(autopilotSessions.status, "active"),
      ),
    )
    .orderBy(desc(autopilotSessions.startedAt))
    .limit(1);
  return row ? toSession(row) : null;
}

/**
 * Every active session joined with its user's signing identity — ONE
 * query, called first thing each tick; zero rows = the cheap idle path.
 */
export async function listActiveSessions(): Promise<
  ActiveSessionWithIdentity[]
> {
  const rows = await db
    .select({
      session: autopilotSessions,
      privyId: users.privyId,
      solanaPubkey: users.solanaPubkey,
    })
    .from(autopilotSessions)
    .innerJoin(users, eq(users.id, autopilotSessions.userId))
    .where(eq(autopilotSessions.status, "active"));
  return rows.map((r) => ({
    ...toSession(r.session),
    privyUserId: r.privyId,
    walletAddress: r.solanaPubkey,
  }));
}

export async function listOpenAutopilotBets(
  sessionId: string,
): Promise<OpenAutopilotBet[]> {
  const rows = await db
    .select()
    .from(bets)
    .where(
      and(
        eq(bets.type, "flash-tail"),
        eq(bets.status, "confirmed"),
        sql`${bets.meta} ->> 'autopilotSessionId' = ${sessionId}`,
      ),
    )
    .orderBy(desc(bets.createdAt));
  const out: OpenAutopilotBet[] = [];
  for (const row of rows) {
    const meta = parseFlashTailMeta(row.meta);
    if (!meta || meta.sourceKind !== "autopilot") continue;
    out.push({
      betId: row.id,
      market: meta.market,
      side: meta.side,
      stakeUsdc: row.amountUsdc,
      leverage: meta.leverage,
      entryPriceUsd: meta.entryPriceUsd,
      createdAt: row.createdAt,
    });
  }
  return out;
}

/** Newest-first realized results for the tilt guard. */
export async function recentClosedAutopilotResults(
  sessionId: string,
  limit = 5,
): Promise<ClosedAutopilotResult[]> {
  const rows = await db
    .select()
    .from(bets)
    .where(
      and(
        eq(bets.type, "flash-tail"),
        inArray(bets.status, ["closed", "closed-external"]),
        sql`${bets.meta} ->> 'autopilotSessionId' = ${sessionId}`,
      ),
    )
    .orderBy(sql`coalesce(${bets.closedAt}, ${bets.createdAt}) DESC`)
    .limit(limit);
  return rows.map((row) => ({
    pnlUsd:
      row.proceedsUsdc == null
        ? -row.amountUsdc
        : row.proceedsUsdc - row.amountUsdc,
    closedAt: row.closedAt ?? row.createdAt,
  }));
}

/**
 * Realized PnL + open/closed counts computed FROM the session's bets rows.
 * Opportunistically syncs the cached column on the session row; failures
 * there are swallowed — the cache is cosmetic, the computation is truth.
 */
export async function sessionStats(sessionId: string): Promise<SessionStats> {
  const [openBets, closedRows] = await Promise.all([
    listOpenAutopilotBets(sessionId),
    db
      .select()
      .from(bets)
      .where(
        and(
          eq(bets.type, "flash-tail"),
          inArray(bets.status, ["closed", "closed-external"]),
          sql`${bets.meta} ->> 'autopilotSessionId' = ${sessionId}`,
        ),
      ),
  ]);
  let realizedPnlUsd = 0;
  for (const row of closedRows) {
    realizedPnlUsd +=
      row.proceedsUsdc == null
        ? -row.amountUsdc
        : row.proceedsUsdc - row.amountUsdc;
  }
  try {
    await db
      .update(autopilotSessions)
      .set({ realizedPnlUsd })
      .where(eq(autopilotSessions.id, sessionId));
  } catch (err) {
    console.warn("[autopilot] realizedPnlUsd cache write failed:", err);
  }
  return { realizedPnlUsd, closedCount: closedRows.length, openBets };
}
