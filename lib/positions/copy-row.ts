export interface CopySourceLike {
  whaleName?: string | null;
  leaderUsername?: string | null;
  leaderAddress?: string | null;
  botName?: string | null;
  botId?: string | null;
}

export type CopySourceBadge = "ai" | "wallet" | null;

/** Derive the badge type for a portfolio row.
 *  Keys on `botId` only — rows where botId is null but botName is "Autopilot"
 *  are autopilot rows, not arena-bot rows, and must return null. */
export function copySourceBadge(row: {
  botId?: string | null;
  botName?: string | null;
  whaleId?: string | null;
  whaleName?: string | null;
}): CopySourceBadge {
  if (row.botId) return "ai";
  if (row.whaleName || row.whaleId) return "wallet";
  return null;
}

function truncateAddress(address: string): string {
  if (address.length <= 8) return address;
  if (address.startsWith("0x") && address.length > 10) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function formatCopySourceLabel(row: CopySourceLike): string {
  if (row.whaleName) return row.whaleName;
  if (row.botName) return row.botName;
  if (row.leaderUsername) return row.leaderUsername;
  if (row.leaderAddress) return truncateAddress(row.leaderAddress);
  if (row.botId) return row.botId;
  return "Copy tail";
}
