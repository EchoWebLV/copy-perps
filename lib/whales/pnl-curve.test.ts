import { describe, expect, it } from "vitest";
import { buildWhalePnlCurve } from "./pnl-curve";
import type { PacificaPositionHistoryRow } from "@/lib/pacifica/types";

function fill(
  createdAt: number,
  pnl: string,
  fee = "0",
): PacificaPositionHistoryRow {
  return {
    history_id: createdAt,
    order_id: createdAt,
    client_order_id: null,
    symbol: "SOL",
    amount: "1",
    price: "100",
    entry_price: "90",
    fee,
    spot_fee: null,
    pnl,
    event_type: "fulfill_taker",
    side: "close_long",
    created_at: createdAt,
    cause: "filled",
  };
}

describe("buildWhalePnlCurve", () => {
  it("anchors cumulative fill history to current all-time PnL", () => {
    const curve = buildWhalePnlCurve({
      history: [
        fill(3000, "20", "1"),
        fill(1000, "10", "2"),
        fill(2000, "-5", "1"),
      ],
      pnlAllTimeUsdc: 100,
      pnl30dUsdc: 30,
      pnl7dUsdc: 20,
      pnl1dUsdc: 5,
      nowMs: 4000,
    });

    expect(curve).toEqual([
      { t: 999, v: 79 },
      { t: 1000, v: 87 },
      { t: 2000, v: 81 },
      { t: 3000, v: 100 },
    ]);
  });

  it("falls back to all-time leaderboard anchors when no history exists", () => {
    const nowMs = Date.UTC(2026, 4, 23);
    const day = 24 * 60 * 60 * 1000;

    const curve = buildWhalePnlCurve({
      history: [],
      pnlAllTimeUsdc: 1000,
      pnl30dUsdc: 300,
      pnl7dUsdc: -70,
      pnl1dUsdc: 10,
      nowMs,
    });

    expect(curve).toEqual([
      { t: nowMs - 30 * day, v: 700 },
      { t: nowMs - 7 * day, v: 1070 },
      { t: nowMs - day, v: 990 },
      { t: nowMs, v: 1000 },
    ]);
  });
});
