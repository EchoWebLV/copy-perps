import type { BotSignal } from "@/lib/types";

// Shared position shape for the live entry chart. The bot feeds that used
// to build these (flattenBotPositions) were removed; LiveEntryChart still
// reuses this type for its own per-position rendering.
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
