// lib/signals/bot-signals.ts
import { db } from "@/lib/db";
import { bots, paperPositions } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getMarksSnapshot } from "@/lib/data/marks";
import { computeLivePaperPnlPct } from "@/lib/bots/paper";
import type { BotSignal } from "@/lib/types";

export async function buildBotSignals(): Promise<BotSignal[]> {
  const botRows = await db
    .select()
    .from(bots)
    .where(eq(bots.status, "paper"));
  if (botRows.length === 0) return [];

  const marks = await getMarksSnapshot();
  const signals: BotSignal[] = [];
  const stamp = new Date().toISOString();

  for (const bot of botRows) {
    const [openRow] = await db
      .select()
      .from(paperPositions)
      .where(
        and(
          eq(paperPositions.botId, bot.id),
          eq(paperPositions.status, "open"),
        ),
      )
      .limit(1);

    const closedRows = await db
      .select()
      .from(paperPositions)
      .where(
        and(
          eq(paperPositions.botId, bot.id),
          eq(paperPositions.status, "closed"),
        ),
      )
      .orderBy(desc(paperPositions.exitTs))
      .limit(200);

    const totalTrades = closedRows.length;
    const wins = closedRows.filter((r) => (r.paperPnlUsd ?? 0) > 0).length;
    const winRate = totalTrades > 0 ? wins / totalTrades : 0;
    const paperPnlAll = closedRows.reduce(
      (s, r) => s + (r.paperPnlUsd ?? 0),
      0,
    );
    const since24h = Date.now() - 24 * 60 * 60 * 1000;
    const paperPnl24h = closedRows
      .filter((r) => r.exitTs && r.exitTs.getTime() >= since24h)
      .reduce((s, r) => s + (r.paperPnlUsd ?? 0), 0);
    const since7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const paperPnl7d = closedRows
      .filter((r) => r.exitTs && r.exitTs.getTime() >= since7d)
      .reduce((s, r) => s + (r.paperPnlUsd ?? 0), 0);

    let currentPosition: BotSignal["payload"]["currentPosition"] = null;
    if (openRow) {
      const currentMark = marks.get(openRow.asset) ?? openRow.entryMark;
      currentPosition = {
        asset: openRow.asset,
        side: openRow.side as "long" | "short",
        leverage: openRow.leverage,
        entryMark: openRow.entryMark,
        currentMark,
        livePaperPnlPct: computeLivePaperPnlPct({
          side: openRow.side as "long" | "short",
          leverage: openRow.leverage,
          entryMark: openRow.entryMark,
          currentMark,
        }),
        openSinceMs: openRow.entryTs.getTime(),
      };
    }

    const heatScore = Math.round(
      500 +
        (currentPosition ? 200 : 0) +
        Math.max(-200, Math.min(200, paperPnl24h / 10)),
    );

    signals.push({
      type: "bot",
      id: `bot:${bot.id}`,
      heatScore,
      createdAt: stamp,
      chips: [],
      payload: {
        botId: bot.id,
        botName: bot.name,
        avatarEmoji: bot.avatarEmoji,
        currentPosition,
        stats: {
          totalTrades,
          winRate,
          paperPnl24hUsd: paperPnl24h,
          paperPnl7dUsd: paperPnl7d,
          paperPnlAllUsd: paperPnlAll,
        },
      },
    });
  }

  return signals;
}
