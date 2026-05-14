import type { PacificaLeaderboardEntry, PacificaPosition } from "@/lib/pacifica/types";

// Score in [0, 1000]. Higher = earlier in feed. Pacifica skews
// heavily toward cross-margin, so isolated high-leverage plays are
// rare and worth prominently surfacing.
//
//   max_position_leverage      0..250  isolated lev>=50:250, >=25:180, >=10:120, >=5:60, else 0
//   has_fresh_position (<1h)   0..200  newest leader trades surface first
//   pnl_1d                     0..150  cap +$10k
//   win_streak                 0..150  6+ = max
//   pnl_7d                     0..100  cap +$50k
//   volume_1d                  0..75   cap $1M
//   equity                     0..75   cap $100k
export function pacificaTraderHeatScore(
  entry: PacificaLeaderboardEntry,
  positions: PacificaPosition[],
  winStreak: number = 0,
): number {
  // Compute the trader's max isolated leverage across their open
  // positions. Cross-margin rows have margin="0" and collapse to 0.
  const maxLev = positions.reduce((max, p) => {
    const margin = Number(p.margin);
    const notional = Math.abs(Number(p.amount) * Number(p.entry_price));
    const lev = margin > 0 ? notional / margin : 0;
    return Math.max(max, lev);
  }, 0);
  const levBonus =
    maxLev >= 50 ? 250 :
    maxLev >= 25 ? 180 :
    maxLev >= 10 ? 120 :
    maxLev >= 5 ? 60 : 0;

  const now = Date.now();
  const oneHourMs = 60 * 60 * 1000;
  const hasFresh = positions.some(
    (p) => Number(p.created_at) > now - oneHourMs,
  );
  const freshNorm = hasFresh ? 200 : positions.length > 0 ? 100 : 0;

  const pnl1d = Number(entry.pnl_1d);
  const pnl7d = Number(entry.pnl_7d);
  const vol1d = Number(entry.volume_1d);
  const eq = Number(entry.equity_current);

  const pnl1dNorm = Math.max(0, Math.min(1, pnl1d / 10_000)) * 150;
  const streakNorm = Math.min(1, winStreak / 6) * 150;
  const pnl7dNorm = Math.max(0, Math.min(1, pnl7d / 50_000)) * 100;
  const volNorm = Math.min(1, vol1d / 1_000_000) * 75;
  const eqNorm = Math.min(1, eq / 100_000) * 75;

  return Math.round(
    levBonus +
      freshNorm +
      pnl1dNorm +
      streakNorm +
      pnl7dNorm +
      volNorm +
      eqNorm,
  );
}
