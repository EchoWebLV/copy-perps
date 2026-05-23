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
  initialLiveEntryChartNowMs,
  type ChartCandle,
} from "./live-entry-chart";

const CANDLE_CACHE_MS = 30_000;
const candleCache = new Map<
  string,
  { expiresAt: number; promise: Promise<ChartCandle[]> }
>();

export interface LiveEntryChartPosition {
  positionId: string;
  asset: string;
  side: FlatPosition["side"];
  leverage: number;
  entryMark: number;
  currentMark: number | null;
  openSinceMs: number;
}

export function LiveEntryChart({ pos }: { pos: LiveEntryChartPosition }) {
  const id = useId().replace(/:/g, "");
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty">("loading");
  const [chartNowMs, setChartNowMs] = useState(() =>
    initialLiveEntryChartNowMs(pos.openSinceMs),
  );

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setChartNowMs(Date.now());
    getCandlesForAsset(pos.asset)
      .then((next) => {
        if (cancelled) return;
        setCandles(next);
        setStatus(next.length > 0 ? "ready" : "empty");
      })
      .catch(() => {
        if (cancelled) return;
        setCandles([]);
        setStatus("empty");
      });
    return () => {
      cancelled = true;
    };
  }, [pos.asset, pos.positionId]);

  const model = useMemo(
    () =>
      buildLiveEntryChartModel({
        candles,
        entryMark: pos.entryMark,
        currentMark: pos.currentMark,
        openSinceMs: pos.openSinceMs,
        nowMs: chartNowMs,
      }),
    [candles, chartNowMs, pos.currentMark, pos.entryMark, pos.openSinceMs],
  );
  const currentMark = model.current.price;
  const entryDelta = ((currentMark - pos.entryMark) / pos.entryMark) * 100;
  const profit =
    pos.side === "long" ? entryDelta >= 0 : entryDelta <= 0;
  const stroke = profit ? GREEN : RED;
  const moveLabel = `${entryDelta >= 0 ? "+" : ""}${entryDelta.toFixed(2)}%`;
  const fillId = `live-entry-fill-${id}`;
  const glowId = `entry-glow-${id}`;
  const entryX = svgCoord(model.entry.x);
  const entryY = svgCoord(model.entry.y);
  const entryLabelX = svgCoord(
    Math.min(model.entry.x + 12, model.plot.right - 92),
  );
  const entryLabelY = svgCoord(
    Math.max(model.entry.y - 10, model.plot.top + 14),
  );
  const currentX = svgCoord(model.current.x);
  const currentY = svgCoord(model.current.y);
  const currentLabelX = svgCoord(
    Math.max(model.current.x - 102, model.plot.left + 8),
  );
  const currentLabelY = svgCoord(
    Math.min(model.current.y + 22, model.plot.bottom - 4),
  );

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
              x1={svgCoord(model.plot.left)}
              x2={svgCoord(model.plot.right)}
              y1={svgCoord(tick.y)}
              y2={svgCoord(tick.y)}
              stroke={FAINT}
              strokeDasharray="4 8"
              strokeOpacity="0.8"
            />
            <text
              x={svgCoord(10)}
              y={svgCoord(tick.y + 4)}
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
              x1={svgCoord(bar.x)}
              x2={svgCoord(bar.x)}
              y1={svgCoord(bar.yHigh)}
              y2={svgCoord(bar.yLow)}
              stroke={bar.up ? GREEN : RED}
              strokeWidth="2"
              strokeLinecap="round"
            />
            <line
              x1={svgCoord(bar.x - 4)}
              x2={svgCoord(bar.x + 4)}
              y1={svgCoord(bar.yClose)}
              y2={svgCoord(bar.yClose)}
              stroke={bar.up ? GREEN : RED}
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>
        ))}

        {model.volumeBars.map((bar, index) => (
          <rect
            key={index}
            x={svgCoord(bar.x - 2)}
            y={svgCoord(bar.y)}
            width="4"
            height={svgCoord(bar.height)}
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
          x1={svgCoord(model.plot.left)}
          x2={svgCoord(model.plot.right)}
          y1={entryY}
          y2={entryY}
          stroke={ACCENT}
          strokeDasharray="7 7"
          strokeWidth="2"
          opacity="0.85"
        />
        <circle
          cx={entryX}
          cy={entryY}
          r="8"
          fill={ACCENT}
          stroke="#0a0a0a"
          strokeWidth="4"
          filter={`url(#${glowId})`}
        />
        <text
          x={entryLabelX}
          y={entryLabelY}
          fill={ACCENT}
          fontSize="13"
          fontWeight="900"
        >
          ENTRY {formatPrice(pos.entryMark)}
        </text>

        <circle
          cx={currentX}
          cy={currentY}
          r="7"
          fill={stroke}
          stroke="#0a0a0a"
          strokeWidth="4"
        />
        <text
          x={currentLabelX}
          y={currentLabelY}
          fill={FG}
          fontSize="13"
          fontWeight="900"
        >
          NOW {formatPrice(currentMark)}
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

function getCandlesForAsset(asset: string): Promise<ChartCandle[]> {
  const key = asset.toUpperCase();
  const now = Date.now();
  const cached = candleCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = fetch(
    `/api/markets/candles?asset=${encodeURIComponent(asset)}&timeframe=1m&count=90`,
    { cache: "no-store" },
  )
    .then(async (res) => {
      if (!res.ok) return [];
      const body = (await res.json()) as { candles?: ChartCandle[] };
      return Array.isArray(body.candles) ? body.candles : [];
    })
    .catch(() => []);

  candleCache.set(key, { expiresAt: now + CANDLE_CACHE_MS, promise });
  return promise;
}

function formatPrice(value: number): string {
  if (Math.abs(value) >= 1000) return `$${value.toFixed(0)}`;
  if (Math.abs(value) >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toPrecision(4)}`;
}

function svgCoord(value: number): string {
  return value.toFixed(2);
}
