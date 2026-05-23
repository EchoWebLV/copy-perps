import type { PacificaPositionHistoryRow } from "@/lib/pacifica/types";

export type WhalePnlPoint = {
  t: number;
  v: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CURVE_POINTS = 48;

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function sampleCurve(points: WhalePnlPoint[]): WhalePnlPoint[] {
  if (points.length <= MAX_CURVE_POINTS) return points;

  const sampled: WhalePnlPoint[] = [];
  const step = (points.length - 1) / (MAX_CURVE_POINTS - 1);
  for (let i = 0; i < MAX_CURVE_POINTS; i++) {
    const idx = Math.round(i * step);
    const point = points[Math.min(idx, points.length - 1)];
    if (!point) continue;
    if (sampled[sampled.length - 1]?.t === point.t) continue;
    sampled.push(point);
  }
  return sampled;
}

export function buildWhalePnlCurve({
  history,
  pnlAllTimeUsdc,
  pnl30dUsdc,
  pnl7dUsdc,
  pnl1dUsdc,
  nowMs = Date.now(),
}: {
  history: PacificaPositionHistoryRow[];
  pnlAllTimeUsdc: number;
  pnl30dUsdc: number;
  pnl7dUsdc: number;
  pnl1dUsdc: number;
  nowMs?: number;
}): WhalePnlPoint[] {
  const rows = history
    .map((row) => {
      const t = finiteNumber(row.created_at);
      const pnl = finiteNumber(row.pnl);
      const fee = finiteNumber(row.fee) ?? 0;
      if (t === null || pnl === null) return null;
      return { t, netPnl: pnl - fee };
    })
    .filter((row): row is { t: number; netPnl: number } => row !== null)
    .sort((a, b) => a.t - b.t);

  if (rows.length === 0) {
    return [
      { t: nowMs - 30 * DAY_MS, v: roundUsd(pnlAllTimeUsdc - pnl30dUsdc) },
      { t: nowMs - 7 * DAY_MS, v: roundUsd(pnlAllTimeUsdc - pnl7dUsdc) },
      { t: nowMs - DAY_MS, v: roundUsd(pnlAllTimeUsdc - pnl1dUsdc) },
      { t: nowMs, v: roundUsd(pnlAllTimeUsdc) },
    ];
  }

  const historyNet = rows.reduce((sum, row) => sum + row.netPnl, 0);
  let running = roundUsd(pnlAllTimeUsdc - historyNet);
  const first = rows[0];
  const points: WhalePnlPoint[] = first
    ? [{ t: first.t - 1, v: running }]
    : [];

  for (const row of rows) {
    running = roundUsd(running + row.netPnl);
    points.push({ t: row.t, v: running });
  }

  return sampleCurve(points);
}
