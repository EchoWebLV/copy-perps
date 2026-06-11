"use client";

// Tiny inline price sparkline for feed cards: one polyline + an optional
// dotted entry-price reference. No axes, no deps — closes in, path out.
// Color follows the position's PnL (GREEN/RED) so the chart reads at a
// glance; DIM when neutral/unknown.

const VIEW_W = 200;
const VIEW_H = 40;

export function Sparkline({
  closes,
  entryPrice,
  color,
  height = 40,
}: {
  closes: number[];
  entryPrice?: number | null;
  color: string;
  height?: number;
}) {
  if (closes.length < 2) return null;

  // Scale into the viewBox with the entry price included in the domain so
  // the reference line never clips out of frame.
  const all =
    entryPrice != null && Number.isFinite(entryPrice)
      ? [...closes, entryPrice]
      : closes;
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (max - min < 1e-9) {
    // Flat series: pad the domain so the line draws mid-frame.
    const pad = Math.max(Math.abs(max) * 0.001, 1e-9);
    min -= pad;
    max += pad;
  }
  const x = (i: number) => (i / (closes.length - 1)) * VIEW_W;
  const y = (v: number) => VIEW_H - ((v - min) / (max - min)) * (VIEW_H - 4) - 2;

  const points = closes.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const entryY =
    entryPrice != null && Number.isFinite(entryPrice) ? y(entryPrice) : null;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      aria-hidden
    >
      {entryY !== null && (
        <line
          x1={0}
          y1={entryY}
          x2={VIEW_W}
          y2={entryY}
          stroke="rgba(250,250,242,0.28)"
          strokeWidth={1}
          strokeDasharray="3 4"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
