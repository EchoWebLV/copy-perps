import type { WhalePnlPoint } from "@/lib/whales/pnl-curve";

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
