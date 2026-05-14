import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { signals } from "@/lib/db/schema";
import {
  getLeaderboard,
  getPositions,
  getPositionsHistory,
} from "@/lib/pacifica/client";
import {
  filterTradeable,
  preRankByActivity,
} from "@/lib/pacifica/leaderboard";
import { pacificaTraderHeatScore } from "@/lib/signals/heat-pacifica-trader";
import type {
  PacificaTraderSignal,
  PacificaTraderPosition,
  SignalChipData,
} from "@/lib/types";
import type {
  PacificaPosition,
  PacificaPositionHistoryRow,
} from "@/lib/pacifica/types";

const SIGNAL_TYPE = "pacifica_trader";
const MAX_SIGNALS = 200;
const POSITION_FETCH_TOP_N = 150;
const POSITIONS_PER_CARD = 3;
const HISTORY_FETCH_LIMIT = 100;

// Convert a Pacifica /positions row into our user-facing trader-position
// shape. notionalUsd = |amount × entry_price|. Leverage is implied
// (notional / margin) for isolated; 0 for cross (margin="0") since
// Pacifica doesn't surface per-position lev on cross.
function toTraderPosition(p: PacificaPosition): PacificaTraderPosition {
  const notional = Math.abs(Number(p.amount) * Number(p.entry_price));
  const margin = Number(p.margin);
  const approxLev = margin > 0 ? Math.round(notional / margin) : 0;
  return {
    market: p.symbol,
    side: p.side === "bid" ? "long" : "short",
    leverage: approxLev,
    notionalUsd: notional,
    entryPrice: Number(p.entry_price),
    liquidationPrice: Number(p.liquidation_price),
    unrealizedPnlPct: null,
    openedAtMs: Number(p.created_at),
  };
}

// Walk recent fills (newest first) grouped by order_id. The first
// order whose side is a "close_*" with summed pnl > 0 starts the
// streak. Continue counting consecutive winning closes until the
// first loser. 1d window: count closes + win rate over last 24h.
function computeTraderStats(rows: PacificaPositionHistoryRow[]): {
  winStreak: number;
  winRatePct1d: number | null;
  totalCloses1d: number;
} {
  // Sum pnl per order_id, latest createdAt and any-close flag.
  interface OrderAgg {
    pnl: number;
    createdAt: number;
    isClose: boolean;
  }
  const byOrder = new Map<number, OrderAgg>();
  for (const r of rows) {
    const isClose = r.side.startsWith("close_");
    const cur = byOrder.get(r.order_id) ?? {
      pnl: 0,
      createdAt: r.created_at,
      isClose,
    };
    cur.pnl += Number(r.pnl);
    cur.createdAt = Math.max(cur.createdAt, r.created_at);
    cur.isClose = cur.isClose || isClose;
    byOrder.set(r.order_id, cur);
  }

  // Closes sorted newest first.
  const closes = [...byOrder.values()]
    .filter((o) => o.isClose)
    .sort((a, b) => b.createdAt - a.createdAt);

  let winStreak = 0;
  for (const c of closes) {
    if (c.pnl > 0) winStreak++;
    else break;
  }

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const closes1d = closes.filter((c) => c.createdAt > oneDayAgo);
  const wins1d = closes1d.filter((c) => c.pnl > 0).length;

  return {
    winStreak,
    winRatePct1d:
      closes1d.length > 0 ? (wins1d / closes1d.length) * 100 : null,
    totalCloses1d: closes1d.length,
  };
}

function buildChips(sig: Omit<PacificaTraderSignal, "chips">): SignalChipData[] {
  const chips: SignalChipData[] = [];
  const top = sig.positions[0];
  if (top) {
    const lev = top.leverage > 0 ? ` ${top.leverage}x` : "";
    chips.push({
      text: `${top.market} ${top.side.toUpperCase()}${lev}`,
      level: top.side === "long" ? "green" : "purple",
    });
  } else {
    chips.push({ text: "Watching", level: "amber" });
  }
  if (sig.stats.winStreak >= 3) {
    chips.push({
      text: `${sig.stats.winStreak} in a row`,
      level: "green",
    });
  }
  return chips;
}

export async function refreshTraders(): Promise<{
  attempted: number;
  written: number;
  errors: Array<{ address: string; message: string }>;
}> {
  const leaderboard = await getLeaderboard();
  const tradeable = filterTradeable(leaderboard);
  const ranked = preRankByActivity(tradeable).slice(0, POSITION_FETCH_TOP_N);
  const result = {
    attempted: ranked.length,
    written: 0,
    errors: [] as { address: string; message: string }[],
  };

  // Lower than v1 because each leader now makes TWO Pacifica calls
  // (positions + positions/history) — concurrency * 2 ≈ peak RPS.
  // Pacifica rate-limits around ~15 RPS for unauthed reads.
  const CONCURRENCY = 4;
  const rows: Array<{
    id: string;
    type: string;
    assetId: string;
    heatScore: number;
    payload: PacificaTraderSignal;
  } | null> = new Array(ranked.length).fill(null);

  let cursor = 0;
  async function worker() {
    while (cursor < ranked.length) {
      const i = cursor++;
      const entry = ranked[i];
      try {
        // Fetch positions + history in parallel for each leader.
        const [rawPositions, history] = await Promise.all([
          getPositions(entry.address),
          getPositionsHistory(entry.address, HISTORY_FETCH_LIMIT).catch(
            () => [] as PacificaPositionHistoryRow[],
          ),
        ]);

        const stats = computeTraderStats(history);
        const heatScore = pacificaTraderHeatScore(
          entry,
          rawPositions,
          stats.winStreak,
        );

        // Order by notional desc, keep top POSITIONS_PER_CARD.
        const sortedPositions = [...rawPositions].sort(
          (a, b) =>
            Math.abs(Number(b.amount) * Number(b.entry_price)) -
            Math.abs(Number(a.amount) * Number(a.entry_price)),
        );
        const traderPositions: PacificaTraderPosition[] = sortedPositions
          .slice(0, POSITIONS_PER_CARD)
          .map(toTraderPosition);

        const partial: Omit<PacificaTraderSignal, "chips"> = {
          id: `${SIGNAL_TYPE}:${entry.address}`,
          type: "pacifica_trader",
          heatScore,
          createdAt: new Date().toISOString(),
          address: entry.address,
          username: entry.username,
          positions: traderPositions,
          stats: {
            equityUsdc: Number(entry.equity_current),
            openInterestUsdc: Number(entry.oi_current),
            pnl1dUsdc: Number(entry.pnl_1d),
            pnl7dUsdc: Number(entry.pnl_7d),
            pnl30dUsdc: Number(entry.pnl_30d),
            pnlAllTimeUsdc: Number(entry.pnl_all_time),
            volume1dUsdc: Number(entry.volume_1d),
            volume7dUsdc: Number(entry.volume_7d),
            winStreak: stats.winStreak,
            winRatePct1d: stats.winRatePct1d,
            totalCloses1d: stats.totalCloses1d,
          },
        };
        const signal: PacificaTraderSignal = {
          ...partial,
          chips: buildChips(partial),
        };

        rows[i] = {
          id: signal.id,
          type: SIGNAL_TYPE,
          assetId: signal.positions[0]?.market ?? "watching",
          heatScore,
          payload: signal,
        };
      } catch (err) {
        result.errors.push({ address: entry.address, message: String(err) });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const valid = rows
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.heatScore - a.heatScore)
    .slice(0, MAX_SIGNALS);

  await db.delete(signals).where(eq(signals.type, SIGNAL_TYPE));
  if (valid.length > 0) await db.insert(signals).values(valid);

  result.written = valid.length;
  return result;
}
