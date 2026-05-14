import type { PacificaLeaderboardEntry, PacificaPosition } from "@/lib/pacifica/types";

// Score in [0, 1000]. Higher = earlier in feed.
// PnL is weighted heavily so winning traders rise; pure volume without
// profit drops to the bottom.
//
//   has_open_position_now      0..400    binary, but no longer dominant
//   pnl_1d_norm                0..200    cap at +$10k (today's degens)
//   pnl_7d_norm                0..200    cap at +$50k (weekly winners)
//   volume_1d_norm             0..150    cap at $1M (activity signal)
//   equity_norm                0..50     cap at $100k (skin in the game)
export function pacificaTraderHeatScore(
  entry: PacificaLeaderboardEntry,
  positions: PacificaPosition[],
): number {
  const hasOpen = positions.length > 0 ? 400 : 0;
  const pnl1d = Number(entry.pnl_1d);
  const pnl7d = Number(entry.pnl_7d);
  const vol1d = Number(entry.volume_1d);
  const eq = Number(entry.equity_current);
  // Only positive PnL contributes; the filter already excludes net losers
  // so this just scales winning intensity.
  const pnl1dNorm = Math.max(0, Math.min(1, pnl1d / 10_000)) * 200;
  const pnl7dNorm = Math.max(0, Math.min(1, pnl7d / 50_000)) * 200;
  const volNorm = Math.min(1, vol1d / 1_000_000) * 150;
  const eqNorm = Math.min(1, eq / 100_000) * 50;
  return Math.round(hasOpen + pnl1dNorm + pnl7dNorm + volNorm + eqNorm);
}
