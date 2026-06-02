export type WhaleSource = "pacifica" | "hyperliquid" | "ostium";
export type WhaleSide = "long" | "short";
export type WhaleStatus = "active" | "hidden" | "retired";
export type WhalePositionStatus = "open" | "closed";

export interface WhaleRecord {
  id: string;
  source: WhaleSource;
  sourceAccount: string;
  displayName: string;
  avatarUrl: string | null;
  status: WhaleStatus;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface WhalePositionRecord {
  id: string;
  whaleId: string;
  source: WhaleSource;
  sourceAccount: string;
  market: string;
  side: WhaleSide;
  leverage: number;
  amountBase: number;
  notionalUsd: number;
  entryPrice: number;
  currentMark: number | null;
  unrealizedPnlPct: number | null;
  openedAt: Date;
  closedAt: Date | null;
  status: WhalePositionStatus;
  raw: Record<string, unknown>;
  lastSeenAt: Date;
}

export interface WhalePositionAnalysis {
  positionId: string;
  summary: string;
  thesis: string;
  risk: string;
  entryGapWarning: string | null;
  confidence: number;
  model: string;
  createdAt: Date;
  updatedAt: Date;
}
