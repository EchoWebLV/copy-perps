// lib/bots/chatter.ts
//
// Reads recent open/close events across every paper bot and returns a
// flat, time-sorted timeline. Used by the /chatter page (the 4th tab).
//
// Each paper_positions row generates up to 2 events: one OPEN when the
// position was opened, one CLOSE when it was closed/expired. Both events
// only show up if the row has narration text for that side; positions
// without narration are skipped so the timeline is always pure prose.

import { db } from "@/lib/db";
import { bots, paperPositions } from "@/lib/db/schema";
import { desc, eq, isNotNull, or } from "drizzle-orm";
import { avatarImageForBot } from "@/lib/bots/avatars";

export type ChatterKind = "open" | "close";

export interface ChatterEvent {
  id: string; // unique per (positionId, kind)
  kind: ChatterKind;
  ts: number; // unix ms
  positionId: string;
  botId: string;
  botName: string;
  avatarEmoji: string;
  avatarImageUrl: string | null;
  asset: string;
  side: "long" | "short";
  leverage: number;
  stakeUsd: number;
  entryMark: number;
  exitMark: number | null;
  paperPnlUsd: number | null;
  narration: string;
}

const DEFAULT_LIMIT = 80;

export async function getChatterEvents(
  limit = DEFAULT_LIMIT,
): Promise<ChatterEvent[]> {
  // Pull rows that have either an open or a close narration.
  const rows = await db
    .select({
      positionId: paperPositions.id,
      botId: paperPositions.botId,
      asset: paperPositions.asset,
      side: paperPositions.side,
      leverage: paperPositions.leverage,
      stakeUsd: paperPositions.stakeUsd,
      entryMark: paperPositions.entryMark,
      entryTs: paperPositions.entryTs,
      exitMark: paperPositions.exitMark,
      exitTs: paperPositions.exitTs,
      paperPnlUsd: paperPositions.paperPnlUsd,
      narrationOpen: paperPositions.narrationOpen,
      narrationClose: paperPositions.narrationClose,
      botName: bots.name,
      avatarEmoji: bots.avatarEmoji,
    })
    .from(paperPositions)
    .innerJoin(bots, eq(bots.id, paperPositions.botId))
    .where(
      or(
        isNotNull(paperPositions.narrationOpen),
        isNotNull(paperPositions.narrationClose),
      ),
    )
    // Pull more than the limit because each row can emit 2 events; we
    // truncate after expansion.
    .orderBy(desc(paperPositions.entryTs))
    .limit(limit * 2);

  const events: ChatterEvent[] = [];
  for (const r of rows) {
    const base = {
      positionId: r.positionId,
      botId: r.botId,
      botName: r.botName,
      avatarEmoji: r.avatarEmoji,
      avatarImageUrl: avatarImageForBot(r.botId),
      asset: r.asset,
      side: r.side as "long" | "short",
      leverage: r.leverage,
      stakeUsd: r.stakeUsd,
      entryMark: r.entryMark,
      exitMark: r.exitMark,
      paperPnlUsd: r.paperPnlUsd,
    };
    if (r.narrationOpen) {
      events.push({
        ...base,
        id: `${r.positionId}|open`,
        kind: "open",
        ts: r.entryTs.getTime(),
        narration: r.narrationOpen,
      });
    }
    if (r.narrationClose && r.exitTs) {
      events.push({
        ...base,
        id: `${r.positionId}|close`,
        kind: "close",
        ts: r.exitTs.getTime(),
        narration: r.narrationClose,
      });
    }
  }
  events.sort((a, b) => b.ts - a.ts);
  return events.slice(0, limit);
}
