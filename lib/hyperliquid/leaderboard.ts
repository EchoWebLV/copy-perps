import type { HLLeaderboardRow } from "./client";
import type { CuratedWhale } from "./whales";

// Turn the raw, market-wide Hyperliquid leaderboard into a tradeable whale
// set. The leaderboard is ranked by raw PnL, which surfaces exactly who we
// DON'T want to tail — lucky one-shot degens and HFT/MM bots. These filters
// encode the hand-won criteria documented on CURATED_WHALES so the dynamic
// feed keeps the same quality bar the manual list had:
//   - directional traders (not market makers / HFT churners)
//   - up over the trailing week (positive 7d PnL)
//   - account value in a sane band ($250k–$50M) — small enough to be a
//     directional player, large enough to be a real whale, below the mega
//     market-maker tier.

export interface TradeableFilterOpts {
  minAccountValueUsd?: number;
  maxAccountValueUsd?: number;
  // Max daily volume / account value. Directional traders turn over a few x
  // their book per day; HFT/MM bots turn over hundreds of x. A generous
  // ceiling drops only the clear bots without punishing aggressive traders.
  maxDailyTurnover?: number;
}

const DEFAULT_FILTER: Required<TradeableFilterOpts> = {
  minAccountValueUsd: 250_000,
  maxAccountValueUsd: 50_000_000,
  maxDailyTurnover: 100,
};

interface WindowStats {
  pnl: number | null;
  roi: number | null;
  vlm: number | null;
}

function finiteOrNull(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function windowStats(
  row: HLLeaderboardRow,
  window: string,
): WindowStats | null {
  const entry = row.windowPerformances.find(([name]) => name === window);
  if (!entry) return null;
  return {
    pnl: finiteOrNull(entry[1].pnl),
    roi: finiteOrNull(entry[1].roi),
    vlm: finiteOrNull(entry[1].vlm),
  };
}

function weeklyPnl(row: HLLeaderboardRow): number {
  return windowStats(row, "week")?.pnl ?? 0;
}

export function filterTradeable(
  rows: HLLeaderboardRow[],
  opts: TradeableFilterOpts = {},
): HLLeaderboardRow[] {
  const minEq = opts.minAccountValueUsd ?? DEFAULT_FILTER.minAccountValueUsd;
  const maxEq = opts.maxAccountValueUsd ?? DEFAULT_FILTER.maxAccountValueUsd;
  const maxTurnover = opts.maxDailyTurnover ?? DEFAULT_FILTER.maxDailyTurnover;

  return rows.filter((row) => {
    const equity = Number(row.accountValue);
    if (!Number.isFinite(equity) || equity < minEq || equity > maxEq) {
      return false;
    }

    const week = windowStats(row, "week");
    if (!week || week.pnl === null || week.pnl <= 0) return false;

    // Bot exclusion: extreme daily churn relative to book size.
    const dailyVlm = windowStats(row, "day")?.vlm ?? 0;
    if (equity > 0 && dailyVlm / equity > maxTurnover) return false;

    return true;
  });
}

export function rankByWeeklyPnl(
  rows: HLLeaderboardRow[],
): HLLeaderboardRow[] {
  return [...rows].sort((a, b) => weeklyPnl(b) - weeklyPnl(a));
}

export function selectTradeableWhales(
  rows: HLLeaderboardRow[],
  opts: { limit: number } & TradeableFilterOpts,
): CuratedWhale[] {
  const { limit, ...filterOpts } = opts;
  return rankByWeeklyPnl(filterTradeable(rows, filterOpts))
    .slice(0, limit)
    .map((row) => {
      const label = row.displayName?.trim();
      return {
        address: row.ethAddress.toLowerCase(),
        label: label && label.length > 0 ? label : undefined,
      };
    });
}
