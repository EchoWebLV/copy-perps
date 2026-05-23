export interface CopySourceLike {
  whaleName?: string | null;
  leaderUsername?: string | null;
  leaderAddress?: string | null;
  botName?: string | null;
  botId?: string | null;
}

function truncateAddress(address: string): string {
  if (address.length <= 8) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function formatCopySourceLabel(row: CopySourceLike): string {
  if (row.whaleName) return row.whaleName;
  if (row.botName) return row.botName;
  if (row.leaderUsername) return row.leaderUsername;
  if (row.leaderAddress) return truncateAddress(row.leaderAddress);
  if (row.botId) return row.botId;
  return "Bot tail";
}
