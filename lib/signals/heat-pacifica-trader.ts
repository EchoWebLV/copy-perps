import type { PacificaLeaderboardEntry, PacificaPosition } from "@/lib/pacifica/types";

// Score in [0, 1000]. Higher = earlier in feed. Wave-1 rebalanced to
// prioritize fresh + on-streak traders so the feed feels snappy.
//
//   has_fresh_position (<1h)   0..300  fresh = newest leader trades surface first
//   pnl_1d                     0..200  cap +$10k (today's degens)
//   win_streak                 0..150  3 wins = 75, 6 wins = 150 (cap)
//   pnl_7d                     0..150  cap +$50k
//   volume_1d                  0..100  cap $1M
//   equity                     0..100  cap $100k
export function pacificaTraderHeatScore(
  entry: PacificaLeaderboardEntry,
  positions: PacificaPosition[],
  winStreak: number = 0,
): number {
  const now = Date.now();
  const oneHourMs = 60 * 60 * 1000;
  const hasFresh = positions.some(
    (p) => Number(p.created_at) > now - oneHourMs,
  );
  const freshNorm = hasFresh ? 300 : positions.length > 0 ? 150 : 0;

  const pnl1d = Number(entry.pnl_1d);
  const pnl7d = Number(entry.pnl_7d);
  const vol1d = Number(entry.volume_1d);
  const eq = Number(entry.equity_current);

  const pnl1dNorm = Math.max(0, Math.min(1, pnl1d / 10_000)) * 200;
  const streakNorm = Math.min(1, winStreak / 6) * 150;
  const pnl7dNorm = Math.max(0, Math.min(1, pnl7d / 50_000)) * 150;
  const volNorm = Math.min(1, vol1d / 1_000_000) * 100;
  const eqNorm = Math.min(1, eq / 100_000) * 100;

  return Math.round(
    freshNorm + pnl1dNorm + streakNorm + pnl7dNorm + volNorm + eqNorm,
  );
}
