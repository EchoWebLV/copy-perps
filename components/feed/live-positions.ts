import type { BotSignal } from "@/lib/types";

export interface FlatPosition {
  positionId: string;
  asset: string;
  side: "long" | "short";
  leverage: number;
  entryMark: number;
  currentMark: number;
  stakeUsd: number;
  livePaperPnlUsd: number;
  livePaperPnlPct: number;
  openSinceMs: number;
  narrationOpen: string | null;
  bot: {
    botId: string;
    botName: string;
    avatarEmoji: string;
    avatarImageUrl: string | null;
    mood: BotSignal["payload"]["mood"];
  };
  disagreements: Array<{
    botId: string;
    botName: string;
    avatarEmoji: string;
    avatarImageUrl: string | null;
  }>;
}

export function flattenBotPositions(
  bots: BotSignal[],
  filter: string | null,
): FlatPosition[] {
  const out: FlatPosition[] = [];
  for (const bot of bots) {
    if (filter && bot.payload.botId !== filter) continue;
    for (const pos of bot.payload.currentPositions) {
      out.push({
        positionId: pos.positionId,
        asset: pos.asset,
        side: pos.side,
        leverage: pos.leverage,
        entryMark: pos.entryMark,
        currentMark: pos.currentMark,
        stakeUsd: pos.stakeUsd,
        livePaperPnlUsd: pos.livePaperPnlUsd,
        livePaperPnlPct: pos.livePaperPnlPct,
        openSinceMs: pos.openSinceMs,
        narrationOpen: pos.narrationOpen,
        bot: {
          botId: bot.payload.botId,
          botName: bot.payload.botName,
          avatarEmoji: bot.payload.avatarEmoji,
          avatarImageUrl: bot.payload.avatarImageUrl,
          mood: bot.payload.mood,
        },
        disagreements: pos.disagreements,
      });
    }
  }
  out.sort((a, b) => b.openSinceMs - a.openSinceMs);
  return out;
}
