import type { PacificaLeaderboardEntry } from "./types";

// Filter to wallets we want to surface in the feed. Stricter than v1:
// must be a winner TODAY (pnl_1d > 0) AND have meaningful 1d volume.
// 7d-only winners (cold weekly swing) don't make the cut anymore.
//
// Net effect: cards lean toward high-turnover degens who are printing
// right now, not patient swing traders.
export function filterTradeable(
  entries: PacificaLeaderboardEntry[],
  opts: {
    minVolume1dUsd?: number;
    minEquityUsd?: number;
  } = {},
): PacificaLeaderboardEntry[] {
  const minVol1d = opts.minVolume1dUsd ?? 50_000;
  const minEq = opts.minEquityUsd ?? 1_000;
  return entries.filter((e) => {
    const vol1d = Number(e.volume_1d);
    const pnl1d = Number(e.pnl_1d);
    const eq = Number(e.equity_current);
    return vol1d >= minVol1d && pnl1d > 0 && eq >= minEq;
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
