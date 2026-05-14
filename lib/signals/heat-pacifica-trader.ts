import type { PacificaLeaderboardEntry, PacificaPosition } from "@/lib/pacifica/types";

// Score in [0, 1000]. Higher = earlier in feed.
//
//   has_open_position_now      0..600
//   volume_1d_norm             0..200   capped at $1M
//   equity_norm                0..100   capped at $100k
//   pnl_7d_norm                -100..100 signed; bad traders sink
export function pacificaTraderHeatScore(
  entry: PacificaLeaderboardEntry,
  positions: PacificaPosition[],
): number {
  const hasOpen = positions.length > 0 ? 600 : 0;
  const vol1d = Number(entry.volume_1d);
  const eq = Number(entry.equity_current);
  const pnl7d = Number(entry.pnl_7d);
  const volNorm = Math.min(1, vol1d / 1_000_000) * 200;
  const eqNorm = Math.min(1, eq / 100_000) * 100;
  const pnlNorm = Math.max(-1, Math.min(1, pnl7d / 50_000)) * 100;
  return Math.round(hasOpen + volNorm + eqNorm + pnlNorm);
}
