import type { PacificaLeaderboardEntry } from "./types";

// Filter to wallets we want to surface in the feed. We require:
//   1. Meaningful recent volume (high-frequency or high-size traders).
//      Either the last 24h or last 7d must clear the floor — catches
//      both daily grinders and weekly swing traders.
//   2. Positive recent PnL (1d OR 7d). Bad traders sink off the feed.
//   3. Non-trivial equity so we don't surface dust accounts.
export function filterTradeable(
  entries: PacificaLeaderboardEntry[],
  opts: {
    minVolume1dUsd?: number;
    minVolume7dUsd?: number;
    minEquityUsd?: number;
  } = {},
): PacificaLeaderboardEntry[] {
  const minVol1d = opts.minVolume1dUsd ?? 50_000;
  const minVol7d = opts.minVolume7dUsd ?? 250_000;
  const minEq = opts.minEquityUsd ?? 1_000;
  return entries.filter((e) => {
    const vol1d = Number(e.volume_1d);
    const vol7d = Number(e.volume_7d);
    const pnl1d = Number(e.pnl_1d);
    const pnl7d = Number(e.pnl_7d);
    const eq = Number(e.equity_current);
    const volumeOk = vol1d >= minVol1d || vol7d >= minVol7d;
    const pnlOk = pnl1d > 0 || pnl7d > 0;
    return volumeOk && pnlOk && eq >= minEq;
  });
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
