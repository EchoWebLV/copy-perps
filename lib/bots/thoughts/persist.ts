// lib/bots/thoughts/persist.ts
//
// Read/write helpers for bot_thoughts. The orchestrator + signal builder
// both use these.

import { db } from "@/lib/db";
import { botThoughts } from "@/lib/db/schema";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { PersistedThought, ThoughtKind } from "./types";

export async function insertThought(args: {
  botId: string;
  kind: ThoughtKind;
  content: string;
  refMeta?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(botThoughts).values({
    botId: args.botId,
    kind: args.kind,
    content: args.content,
    refMeta: args.refMeta ?? null,
  });
}

/**
 * For each bot, the most-recent thought of any kind. Used by the bot card
 * to surface a headline. Returns a Map keyed by botId.
 */
export async function getLatestThoughtPerBot(): Promise<
  Map<string, PersistedThought>
> {
  // DISTINCT ON (bot_id) ordered by created_at desc.
  const rows = await db.execute<{
    id: string;
    bot_id: string;
    kind: string;
    content: string;
    ref_meta: unknown;
    created_at: Date;
  }>(sql`
    SELECT DISTINCT ON (bot_id) id, bot_id, kind, content, ref_meta, created_at
    FROM bot_thoughts
    ORDER BY bot_id, created_at DESC
  `);
  const map = new Map<string, PersistedThought>();
  for (const r of rows.rows) {
    map.set(r.bot_id, {
      id: r.id,
      botId: r.bot_id,
      kind: r.kind as ThoughtKind,
      content: r.content,
      refMeta: (r.ref_meta as Record<string, unknown> | null) ?? null,
      createdAt: r.created_at,
    });
  }
  return map;
}

/** Most recent thought timestamp for a specific (bot, kind). Null if none. */
export async function getLastThoughtTimestamp(
  botId: string,
  kind: ThoughtKind,
): Promise<Date | null> {
  const rows = await db
    .select({ createdAt: botThoughts.createdAt })
    .from(botThoughts)
    .where(and(eq(botThoughts.botId, botId), eq(botThoughts.kind, kind)))
    .orderBy(desc(botThoughts.createdAt))
    .limit(1);
  return rows[0]?.createdAt ?? null;
}

/** Count of thoughts inserted in the last 60s. Used for global cap. */
export async function getThoughtsInLastMinute(): Promise<number> {
  const cutoff = new Date(Date.now() - 60_000);
  const rows = await db
    .select({ id: botThoughts.id })
    .from(botThoughts)
    .where(gt(botThoughts.createdAt, cutoff));
  return rows.length;
}
