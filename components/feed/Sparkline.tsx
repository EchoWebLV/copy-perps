"use client";

// Inline position chart for feed cards: price path + gradient fill + live
// end-dot, anchored to the entry price. No axes, no deps.
//
// The entry anchor has two modes (the fix for "every chart looks flat"):
//  - NEAR: entry sits within one chart-range of the closes → include it in
//    the domain and draw the dashed reference line.
//  - FAR: a 12-day-old entry 15% away would squash the live price action
//    into a flat sliver (the old behavior) — so the domain stays on the
//    closes and the entry renders as an edge tag ("entry 15.9% below")
//    instead of a line.

import { useId } from "react";

const VIEW_W = 200;
const VIEW_H = 40;

export function Sparkline({
  closes,
  entryPrice,
  color,
  height = 40,
  live = false,
}: {
  closes: number[];
  entryPrice?: number | null;
  color: string;
  height?: number;
  /** Pulse the end-of-line dot (fresh, actively-updating positions). */
  live?: boolean;
}) {
  // Stable per-instance gradient id (hooks before any early return).
  const gradientId = useId();
  if (closes.length < 2) return null;

  let cMin = Math.min(...closes);
  let cMax = Math.max(...closes);
  if (!Number.isFinite(cMin) || !Number.isFinite(cMax)) return null;
  if (cMax - cMin < 1e-9) {
    const pad = Math.max(Math.abs(cMax) * 0.001, 1e-9);
    cMin -= pad;
    cMax += pad;
  }
  const closesSpan = cMax - cMin;

  const entry =
    entryPrice != null && Number.isFinite(entryPrice) ? entryPrice : null;
  const entryNear =
    entry !== null &&
    entry >= cMin - closesSpan &&
    entry <= cMax + closesSpan;

  let min = cMin;
  let max = cMax;
  if (entry !== null && entryNear) {
    min = Math.min(min, entry);
    max = Math.max(max, entry);
  }
  // Breathing room so the path never kisses the frame.
  const pad = (max - min) * 0.08;
  min -= pad;
  max += pad;

  const x = (i: number) => (i / (closes.length - 1)) * VIEW_W;
  const y = (v: number) => VIEW_H - ((v - min) / (max - min)) * VIEW_H;

  const points = closes
    .map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  const areaPath =
    `M0,${VIEW_H} ` +
    closes.map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ") +
    ` L${VIEW_W},${VIEW_H} Z`;
  const lastX = VIEW_W;
  const lastY = y(closes[closes.length - 1]!);

  const entryY = entry !== null && entryNear ? y(entry) : null;
  const last = closes[closes.length - 1]!;
  const entryGapPct =
    entry !== null && !entryNear && entry > 0
      ? ((last - entry) / entry) * 100
      : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        aria-hidden
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        {entryY !== null && (
          <line
            x1={0}
            y1={entryY}
            x2={VIEW_W}
            y2={entryY}
            stroke="rgba(250,250,242,0.30)"
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
        <circle cx={lastX} cy={lastY} r={2.4} fill={color}>
          {live && (
            <animate
              attributeName="opacity"
              values="1;0.35;1"
              dur="1.6s"
              repeatCount="indefinite"
            />
          )}
        </circle>
        {live && (
          <circle cx={lastX} cy={lastY} r={2.4} fill="none" stroke={color}>
            <animate
              attributeName="r"
              values="2.4;7"
              dur="1.6s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="stroke-opacity"
              values="0.6;0"
              dur="1.6s"
              repeatCount="indefinite"
            />
          </circle>
        )}
      </svg>
      {entryY !== null && (
        <span
          className="pointer-events-none absolute left-0 text-[7px] font-black uppercase tracking-widest"
          style={{
            color: "rgba(250,250,242,0.45)",
            top: `${Math.min(Math.max((entryY / VIEW_H) * 100, 4), 82)}%`,
            transform: "translateY(2px)",
          }}
        >
          entry
        </span>
      )}
      {entryGapPct !== null && (
        <span
          className={`pointer-events-none absolute left-0 ${
            entryGapPct >= 0 ? "bottom-0" : "top-0"
          } rounded px-1 py-0.5 text-[7px] font-black uppercase tracking-widest`}
          style={{
            color: "rgba(250,250,242,0.55)",
            background: "rgba(250,250,242,0.06)",
          }}
        >
          entry {Math.abs(entryGapPct).toFixed(1)}% {entryGapPct >= 0 ? "below" : "above"}
        </span>
      )}
    </div>
  );
}
