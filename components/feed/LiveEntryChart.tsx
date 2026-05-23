"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  ACCENT,
  DIM,
  FAINT,
  FG,
  GREEN,
  PANEL_2,
  RED,
} from "@/components/v2/ui";
import type { FlatPosition } from "./live-positions";
import {
  buildLiveEntryChartModel,
  type ChartCandle,
} from "./live-entry-chart";

export interface LiveEntryChartPosition {
  positionId: string;
  asset: string;
  side: FlatPosition["side"];
  leverage: number;
  entryMark: number;
  currentMark: number;
  openSinceMs: number;
}

export function LiveEntryChart({ pos }: { pos: LiveEntryChartPosition }) {
  const id = useId().replace(/:/g, "");
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty">("loading");

  useEffect(() => {
    const ctrl = new AbortController();
    setStatus("loading");
    fetch(
      `/api/markets/candles?asset=${encodeURIComponent(pos.asset)}&timeframe=1m&count=90`,
      { cache: "no-store", signal: ctrl.signal },
    )
      .then(async (res) => {
        if (!res.ok) return [];
        const body = (await res.json()) as { candles?: ChartCandle[] };
        return Array.isArray(body.candles) ? body.candles : [];
      })
      .then((next) => {
        if (ctrl.signal.aborted) return;
        setCandles(next);
        setStatus(next.length > 0 ? "ready" : "empty");
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setCandles([]);
        setStatus("empty");
      });
    return () => ctrl.abort();
  }, [pos.asset, pos.positionId]);

  const model = useMemo(
    () =>
      buildLiveEntryChartModel({
        candles,
        entryMark: pos.entryMark,
        currentMark: pos.currentMark,
        openSinceMs: pos.openSinceMs,
        nowMs: Date.now(),
      }),
    [candles, pos.currentMark, pos.entryMark, pos.openSinceMs],
  );
  const entryDelta = ((pos.currentMark - pos.entryMark) / pos.entryMark) * 100;
  const profit =
    pos.side === "long" ? entryDelta >= 0 : entryDelta <= 0;
  const stroke = profit ? GREEN : RED;
  const moveLabel = `${entryDelta >= 0 ? "+" : ""}${entryDelta.toFixed(2)}%`;
  const fillId = `live-entry-fill-${id}`;
  const glowId = `entry-glow-${id}`;

  return (
    <div
      className="mt-5 overflow-hidden rounded-2xl"
      style={{ background: PANEL_2, border: `1px solid ${FAINT}` }}
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div>
          <div
            className="text-[10px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            1m tape · entry mark
          </div>
          <div className="mt-1 text-[13px] font-black uppercase tracking-widest">
            {pos.asset} {pos.side} ×{pos.leverage}
          </div>
        </div>
        <div className="text-right">
          <div
            className="text-[10px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            Move from entry
          </div>
          <div className="mt-1 text-[16px] font-black tabular-nums" style={{ color: stroke }}>
            {moveLabel}
          </div>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${model.width} ${model.height}`}
        role="img"
        aria-label={`${pos.asset} price chart with entry marker`}
        className="mt-1 block w-full"
      >
        <defs>
          <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
          <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {model.yTicks.map((tick) => (
          <g key={tick.price}>
            <line
              x1={model.plot.left}
              x2={model.plot.right}
              y1={tick.y}
              y2={tick.y}
              stroke={FAINT}
              strokeDasharray="4 8"
              strokeOpacity="0.8"
            />
            <text
              x={10}
              y={tick.y + 4}
              fill={DIM}
              fontSize="11"
              fontWeight="900"
            >
              {formatPrice(tick.price)}
            </text>
          </g>
        ))}

        {model.rangeBars.map((bar, index) => (
          <g key={index} opacity="0.52">
            <line
              x1={bar.x}
              x2={bar.x}
              y1={bar.yHigh}
              y2={bar.yLow}
              stroke={bar.up ? GREEN : RED}
              strokeWidth="2"
              strokeLinecap="round"
            />
            <line
              x1={bar.x - 4}
              x2={bar.x + 4}
              y1={bar.yClose}
              y2={bar.yClose}
              stroke={bar.up ? GREEN : RED}
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>
        ))}

        {model.volumeBars.map((bar, index) => (
          <rect
            key={index}
            x={bar.x - 2}
            y={bar.y}
            width="4"
            height={bar.height}
            rx="2"
            fill={bar.up ? GREEN : RED}
            opacity="0.22"
          />
        ))}

        <path
          d={model.areaPath}
          fill={`url(#${fillId})`}
        />
        <path
          d={model.linePath}
          fill="none"
          stroke={stroke}
          strokeWidth="4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        <line
          x1={model.plot.left}
          x2={model.plot.right}
          y1={model.entry.y}
          y2={model.entry.y}
          stroke={ACCENT}
          strokeDasharray="7 7"
          strokeWidth="2"
          opacity="0.85"
        />
        <circle
          cx={model.entry.x}
          cy={model.entry.y}
          r="8"
          fill={ACCENT}
          stroke="#0a0a0a"
          strokeWidth="4"
          filter={`url(#${glowId})`}
        />
        <text
          x={Math.min(model.entry.x + 12, model.plot.right - 92)}
          y={Math.max(model.entry.y - 10, model.plot.top + 14)}
          fill={ACCENT}
          fontSize="13"
          fontWeight="900"
        >
          ENTRY {formatPrice(pos.entryMark)}
        </text>

        <circle
          cx={model.current.x}
          cy={model.current.y}
          r="7"
          fill={stroke}
          stroke="#0a0a0a"
          strokeWidth="4"
        />
        <text
          x={Math.max(model.current.x - 102, model.plot.left + 8)}
          y={Math.min(model.current.y + 22, model.plot.bottom - 4)}
          fill={FG}
          fontSize="13"
          fontWeight="900"
        >
          NOW {formatPrice(pos.currentMark)}
        </text>
      </svg>

      <div
        className="flex items-center justify-between border-t px-4 py-3 text-[10px] font-black uppercase tracking-widest"
        style={{ borderColor: FAINT, color: DIM }}
      >
        <span>{status === "loading" ? "Loading candles" : status === "empty" ? "Live mark fallback" : `${candles.length} candles`}</span>
        <span>{model.entry.clamped ? "Entry before window" : "Entry in window"}</span>
      </div>
    </div>
  );
}

function formatPrice(value: number): string {
  if (Math.abs(value) >= 1000) return `$${value.toFixed(0)}`;
  if (Math.abs(value) >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toPrecision(4)}`;
}
