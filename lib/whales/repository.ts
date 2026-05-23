import { and, desc, eq, inArray, lt, not } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  whales,
  whalePositions,
  whalePositionAnalysis,
} from "@/lib/db/schema";
import type {
  WhalePositionAnalysis,
  WhalePositionRecord,
  WhaleRecord,
  WhaleSource,
} from "./types";

function mapWhale(row: typeof whales.$inferSelect): WhaleRecord {
  return {
    ...row,
    source: row.source as WhaleSource,
    status: row.status as WhaleRecord["status"],
  };
}

function mapWhalePosition(
  row: typeof whalePositions.$inferSelect,
): WhalePositionRecord {
  return {
    ...row,
    source: row.source as WhalePositionRecord["source"],
    side: row.side as WhalePositionRecord["side"],
    status: row.status as WhalePositionRecord["status"],
  };
}

export async function upsertWhale(args: {
  id: string;
  source: WhaleSource;
  sourceAccount: string;
  displayName: string;
  avatarUrl: string | null;
  tags: string[];
}): Promise<void> {
  const updatedAt = new Date();
  await db
    .insert(whales)
    .values({
      id: args.id,
      source: args.source,
      sourceAccount: args.sourceAccount,
      displayName: args.displayName,
      avatarUrl: args.avatarUrl,
      status: "active",
      tags: args.tags,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: whales.id,
      set: {
        displayName: args.displayName,
        avatarUrl: args.avatarUrl,
        tags: args.tags,
        status: "active",
        updatedAt,
      },
    });
}

export async function upsertWhalePosition(
  pos: WhalePositionRecord,
): Promise<void> {
  await db
    .insert(whalePositions)
    .values(pos)
    .onConflictDoUpdate({
      target: whalePositions.id,
      set: {
        leverage: pos.leverage,
        amountBase: pos.amountBase,
        notionalUsd: pos.notionalUsd,
        entryPrice: pos.entryPrice,
        currentMark: pos.currentMark,
        unrealizedPnlPct: pos.unrealizedPnlPct,
        raw: pos.raw,
        status: "open",
        closedAt: null,
        lastSeenAt: pos.lastSeenAt,
      },
    });
}

export async function markMissingWhalePositionsClosed(args: {
  source: WhaleSource;
  sourceAccount: string;
  openPositionIds: string[];
  graceCutoff: Date;
}): Promise<void> {
  await db
    .update(whalePositions)
    .set({
      status: "closed",
      closedAt: new Date(),
    })
    .where(
      and(
        eq(whalePositions.source, args.source),
        eq(whalePositions.sourceAccount, args.sourceAccount),
        eq(whalePositions.status, "open"),
        lt(whalePositions.lastSeenAt, args.graceCutoff),
        not(inArray(whalePositions.id, args.openPositionIds)),
      ),
    );
}

export async function markMissingPacificaPositionsClosed(args: {
  sourceAccount: string;
  openPositionIds: string[];
  graceCutoff: Date;
}): Promise<void> {
  await markMissingWhalePositionsClosed({
    source: "pacifica",
    ...args,
  });
}

export async function getOpenWhalePositions(
  limit = 100,
): Promise<WhalePositionRecord[]> {
  const rows = await db
    .select()
    .from(whalePositions)
    .where(eq(whalePositions.status, "open"))
    .orderBy(desc(whalePositions.lastSeenAt))
    .limit(limit);
  return rows.map(mapWhalePosition);
}

export async function getOpenWhalePositionsForSource(args: {
  source: WhaleSource;
  sourceAccount: string;
}): Promise<WhalePositionRecord[]> {
  const rows = await db
    .select()
    .from(whalePositions)
    .where(
      and(
        eq(whalePositions.source, args.source),
        eq(whalePositions.sourceAccount, args.sourceAccount),
        eq(whalePositions.status, "open"),
      ),
    );
  return rows.map(mapWhalePosition);
}

export async function getWhalesByIds(
  ids: string[],
): Promise<Map<string, WhaleRecord>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(whales).where(inArray(whales.id, ids));
  return new Map(rows.map((row) => [row.id, mapWhale(row)]));
}

export async function upsertWhaleAnalysis(
  analysis: WhalePositionAnalysis,
): Promise<void> {
  await db
    .insert(whalePositionAnalysis)
    .values(analysis)
    .onConflictDoUpdate({
      target: whalePositionAnalysis.positionId,
      set: {
        summary: analysis.summary,
        thesis: analysis.thesis,
        risk: analysis.risk,
        entryGapWarning: analysis.entryGapWarning,
        confidence: analysis.confidence,
        model: analysis.model,
        updatedAt: analysis.updatedAt,
      },
    });
}
