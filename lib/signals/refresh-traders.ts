import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { signals } from "@/lib/db/schema";
import { getLeaderboard, getPositions } from "@/lib/pacifica/client";
import {
  filterTradeable,
  preRankByActivity,
} from "@/lib/pacifica/leaderboard";
import { pacificaTraderHeatScore } from "@/lib/signals/heat-pacifica-trader";
import type { PacificaTraderSignal, SignalChipData } from "@/lib/types";
import type { PacificaPosition } from "@/lib/pacifica/types";

const SIGNAL_TYPE = "pacifica_trader";
const MAX_SIGNALS = 200;
const POSITION_FETCH_TOP_N = 150;

function pickFirstPosition(positions: PacificaPosition[]) {
  if (positions.length === 0) return null;
  const sorted = [...positions].sort(
    (a, b) =>
      Math.abs(Number(b.amount) * Number(b.entry_price)) -
      Math.abs(Number(a.amount) * Number(a.entry_price)),
  );
  return sorted[0];
}

function buildChips(sig: Omit<PacificaTraderSignal, "chips">): SignalChipData[] {
  if (!sig.position) return [{ text: "Watching", level: "amber" }];
  const lev = Math.round(sig.position.leverage);
  return [
    {
      text: `${sig.position.market} ${sig.position.side.toUpperCase()}${lev > 0 ? ` ${lev}x` : ""}`,
      level: sig.position.side === "long" ? "green" : "purple",
    },
  ];
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

  const CONCURRENCY = 10;
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
        const positions = await getPositions(entry.address);
        const heatScore = pacificaTraderHeatScore(entry, positions);
        const first = pickFirstPosition(positions);

        const sigPos = first
          ? (() => {
              const notional = Math.abs(Number(first.amount) * Number(first.entry_price));
              const margin = Number(first.margin);
              const approxLev = margin > 0 ? notional / margin : 0;
              return {
                market: first.symbol,
                side: (first.side === "bid" ? "long" : "short") as "long" | "short",
                leverage: approxLev > 0 ? Math.round(approxLev) : 0,
                notionalUsd: notional,
                entryPrice: Number(first.entry_price),
                liquidationPrice: Number(first.liquidation_price),
                unrealizedPnlPct: null,
              };
            })()
          : null;

        const partial: Omit<PacificaTraderSignal, "chips"> = {
          id: `${SIGNAL_TYPE}:${entry.address}`,
          type: "pacifica_trader",
          heatScore,
          createdAt: new Date().toISOString(),
          address: entry.address,
          username: entry.username,
          position: sigPos,
          stats: {
            equityUsdc: Number(entry.equity_current),
            openInterestUsdc: Number(entry.oi_current),
            pnl1dUsdc: Number(entry.pnl_1d),
            pnl7dUsdc: Number(entry.pnl_7d),
            pnl30dUsdc: Number(entry.pnl_30d),
            pnlAllTimeUsdc: Number(entry.pnl_all_time),
            volume1dUsdc: Number(entry.volume_1d),
            volume7dUsdc: Number(entry.volume_7d),
          },
        };
        const signal: PacificaTraderSignal = {
          ...partial,
          chips: buildChips(partial),
        };

        rows[i] = {
          id: signal.id,
          type: SIGNAL_TYPE,
          assetId: signal.position?.market ?? "watching",
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
