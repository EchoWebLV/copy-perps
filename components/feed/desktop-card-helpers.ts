// Pure helpers for the resurrected desktop whale card (DesktopWhaleCard).
//
// Recovered verbatim from the old WhaleRoster's support modules — deleted in
// 8287fbd when the unified stacked feed replaced the roster — and brought
// back on founder feedback ("return the old cards on desktop"):
//   - buildWhaleExposureSummary ← components/whales/whale-exposure-summary.ts
//   - buildPnlChartPath         ← components/whales/pnl-chart.ts
// Renderer-free so the recovered unit tests keep running against them.

import type { WhaleTraderSignal } from "@/lib/types";
import { isFlashCopyableMarket } from "@/lib/flash/markets";
import { isSourceFresh } from "@/lib/whales/identity";
import type { WhalePnlPoint } from "@/lib/whales/pnl-curve";

type WhaleOpenPosition = WhaleTraderSignal["payload"]["openPositions"][number];

export interface WhaleExposureSummary {
  totalCount: number;
  copyableCount: number;
  staleCount: number;
  longCount: number;
  shortCount: number;
  exposureUsd: number;
  stanceLabel: string;
  largestPosition: WhaleOpenPosition | null;
}

export function buildWhaleExposureSummary(
  positions: WhaleOpenPosition[],
  nowMs = Date.now(),
): WhaleExposureSummary {
  let copyableCount = 0;
  let staleCount = 0;
  let longCount = 0;
  let shortCount = 0;
  let exposureUsd = 0;
  let largestPosition: WhaleOpenPosition | null = null;

  for (const position of positions) {
    if (isWhaleOpenPositionSupported(position)) {
      copyableCount += 1;
    }
    if (isWhaleOpenPositionStale(position, nowMs)) staleCount += 1;
    if (position.side === "long") longCount += 1;
    else shortCount += 1;
    exposureUsd += position.notionalUsd;
    if (
      largestPosition === null ||
      position.notionalUsd > largestPosition.notionalUsd
    ) {
      largestPosition = position;
    }
  }

  const totalCount = positions.length;

  return {
    totalCount,
    copyableCount,
    staleCount,
    longCount,
    shortCount,
    exposureUsd,
    stanceLabel:
      totalCount === 0
        ? "NO OPEN POSITIONS"
        : `${longCount} LONG / ${shortCount} SHORT`,
    largestPosition,
  };
}

function isWhaleOpenPositionSupported(position: WhaleOpenPosition): boolean {
  return isFlashCopyableMarket(position.market);
}

function isWhaleOpenPositionStale(
  position: WhaleOpenPosition,
  nowMs: number,
): boolean {
  return (
    position.stale ||
    (nowMs > 0 && !isSourceFresh(position.lastSeenAtMs, undefined, nowMs))
  );
}

export function buildPnlChartPath(
  points: WhalePnlPoint[],
  width: number,
  height: number,
): string {
  if (points.length === 0) return "";

  const minT = Math.min(...points.map((point) => point.t));
  const maxT = Math.max(...points.map((point) => point.t));
  const minV = Math.min(...points.map((point) => point.v));
  const maxV = Math.max(...points.map((point) => point.v));
  const timeSpan = Math.max(1, maxT - minT);
  const valueSpan = Math.max(1, maxV - minV);

  return points
    .map((point, idx) => {
      const x = ((point.t - minT) / timeSpan) * width;
      const y = height - ((point.v - minV) / valueSpan) * height;
      return `${idx === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}
