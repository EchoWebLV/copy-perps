import type { PacificaLeaderboardEntry } from "./types";

// Filter to wallets we want to surface in the feed. Excludes traders
// with low recent activity, tiny equity, or catastrophic all-time PnL.
export function filterTradeable(
  entries: PacificaLeaderboardEntry[],
  opts: {
    minVolume1dUsd?: number;
    minEquityUsd?: number;
    minPnlAllTimeUsd?: number;
  } = {},
): PacificaLeaderboardEntry[] {
  const minVol = opts.minVolume1dUsd ?? 5000;
  const minEq = opts.minEquityUsd ?? 1000;
  const minPnl = opts.minPnlAllTimeUsd ?? -500_000;
  return entries.filter(
    (e) =>
      Number(e.volume_1d) >= minVol &&
      Number(e.equity_current) >= minEq &&
      Number(e.pnl_all_time) >= minPnl,
  );
}

// Sort by 1d volume descending. Used to pre-rank candidates before
// applying heat scoring, so we fetch positions for the top-N most
// active traders only (Pacifica's positions endpoint is per-account).
export function preRankByActivity(
  entries: PacificaLeaderboardEntry[],
): PacificaLeaderboardEntry[] {
  return [...entries].sort(
    (a, b) => Number(b.volume_1d) - Number(a.volume_1d),
  );
}
