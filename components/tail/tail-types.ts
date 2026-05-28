export type WhaleTailPosition = {
  sourcePositionId: string;
  asset: string;
  side: "long" | "short";
  leverage: number;
  maxLeverage?: number | null;
  entryMark: number;
  currentMark: number | null;
  stale: boolean;
  lastSeenAtMs: number;
  copyableOnPacifica?: boolean;
  notionalUsd?: number;
  unrealizedPnlPct?: number | null;
};

export type TailSource =
  | {
      kind: "bot";
      botId: string;
      botName: string;
      avatarEmoji?: string;
      avatarImageUrl?: string | null;
      asset: string;
      side: "long" | "short";
      leverage: number;
      maxLeverage?: number | null;
      entryMark: number;
      positionId?: string;
    }
  | {
      kind: "whale";
      whaleId: string;
      displayName: string;
      avatarUrl: string | null;
      sourceAccount: string;
      sourcePositionId: string;
      asset: string;
      side: "long" | "short";
      leverage: number;
      maxLeverage?: number | null;
      entryMark: number;
      currentMark: number | null;
      stale: boolean;
      lastSeenAtMs: number;
      positions: WhaleTailPosition[];
    };
