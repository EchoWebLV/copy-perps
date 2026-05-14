// lib/signals/bot-signals.ts
import { db } from "@/lib/db";
import { bots, paperPositions } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getMarksSnapshot } from "@/lib/data/marks";
import { computeLivePaperPnlPct } from "@/lib/bots/paper";
import { getCrossBotSnapshot } from "@/lib/bots/cross-bot";
import type { BotSignal } from "@/lib/types";

export async function buildBotSignals(): Promise<BotSignal[]> {
  // Hide busted bots from the feed for now. Phase 3+ may surface them
  // as a separate tab / dim them visually.
  const botRows = await db
    .select()
    .from(bots)
    .where(eq(bots.status, "paper"));
  if (botRows.length === 0) return [];

  // Lookup table: botId → display info (built once for disagreement resolution)
  const botLookup = new Map<string, { name: string; avatarEmoji: string }>();
  for (const b of botRows) {
    botLookup.set(b.id, { name: b.name, avatarEmoji: b.avatarEmoji });
  }

  const marks = await getMarksSnapshot();
  // Fetch the cross-bot snapshot once; used for disagreement computation per position.
  const crossBot = await getCrossBotSnapshot();
  const signals: BotSignal[] = [];
  const stamp = new Date().toISOString();

  for (const bot of botRows) {
    const openRows = await db
      .select()
      .from(paperPositions)
      .where(
        and(
          eq(paperPositions.botId, bot.id),
          eq(paperPositions.status, "open"),
        ),
      );

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

    const currentPositions = openRows.map((openRow) => {
      const currentMark = marks.get(openRow.asset) ?? openRow.entryMark;
      const livePaperPnlPct = computeLivePaperPnlPct({
        side: openRow.side as "long" | "short",
        leverage: openRow.leverage,
        entryMark: openRow.entryMark,
        currentMark,
        asset: openRow.asset,
        stakeUsd: openRow.stakeUsd,
      });

      // Find other bots holding the opposite side of this asset.
      const opposite: "long" | "short" =
        openRow.side === "long" ? "short" : "long";
      const sameAsset = crossBot.botsByAsset.get(openRow.asset) ?? [];
      const disagreements = sameAsset
        .filter(
          (entry) => entry.side === opposite && entry.botId !== bot.id,
        )
        .map((entry) => {
          const meta = botLookup.get(entry.botId);
          return {
            botId: entry.botId,
            botName: meta?.name ?? entry.botId,
            avatarEmoji: meta?.avatarEmoji ?? "🤖",
          };
        });

      return {
        positionId: openRow.id,
        asset: openRow.asset,
        side: openRow.side as "long" | "short",
        leverage: openRow.leverage,
        entryMark: openRow.entryMark,
        currentMark,
        stakeUsd: openRow.stakeUsd,
        livePaperPnlPct,
        livePaperPnlUsd: livePaperPnlPct * openRow.stakeUsd,
        openSinceMs: openRow.entryTs.getTime(),
        narrationOpen: openRow.narrationOpen,
        triggerMeta:
          (openRow.triggerMeta as Record<string, unknown> | null) ?? null,
        disagreements,
      };
    });

    const lockedStake = currentPositions.reduce(
      (s, p) => s + p.stakeUsd,
      0,
    );
    const unrealizedUsd = currentPositions.reduce(
      (s, p) => s + p.livePaperPnlUsd,
      0,
    );
    // Equity = cash + unrealized PnL. This is the headline "what is this bot
    // actually worth right now" number. Cash alone hides losses on still-open
    // positions and makes the leaderboard misleading.
    const equityUsd = bot.balanceUsd + unrealizedUsd;
    const freeBalance = bot.balanceUsd - lockedStake;
    const lifetimeReturnPct =
      (equityUsd - bot.startingBalanceUsd) / bot.startingBalanceUsd;
    // Win rate is noisy below a handful of trades; null tells the UI to hide
    // it rather than show "0%" off a single losing trade.
    const WIN_RATE_MIN_TRADES = 5;
    const winRateOrNull =
      totalTrades >= WIN_RATE_MIN_TRADES ? winRate : null;

    const heatScore = Math.round(
      500 +
        currentPositions.length * 50 +
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
        balanceUsd: equityUsd,
        cashUsd: bot.balanceUsd,
        startingBalanceUsd: bot.startingBalanceUsd,
        lifetimeReturnPct,
        freeBalanceUsd: freeBalance,
        busted: bot.status === "busted",
        currentPositions,
        stats: {
          totalTrades,
          winRate: winRateOrNull,
          paperPnl24hUsd: paperPnl24h,
          paperPnl7dUsd: paperPnl7d,
          paperPnlAllUsd: paperPnlAll,
        },
      },
    });
  }

  return signals;
}
