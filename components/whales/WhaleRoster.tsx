"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Layers, Zap } from "lucide-react";
import type { WhaleTraderSignal } from "@/lib/types";
import { BalancePill } from "@/components/shell/BalancePill";
import { TailModal, type TailSource } from "@/components/tail/TailModal";
import { buildPnlChartPath } from "./pnl-chart";
import { formatSignedWhaleUsd } from "./whale-money";
import { buildWhaleTailSource } from "./whale-tail-source";
import {
  buildWhaleExposureSummary,
  type WhaleExposureSummary,
} from "./whale-exposure-summary";
import {
  ACCENT,
  BG,
  DIM,
  FAINT,
  FG,
  FONT_DISPLAY,
  GREEN,
  Headline,
  PANEL,
  PANEL_2,
  RED,
  StoryAvatar,
} from "@/components/v2/ui";

const POLL_MS = 4_000;

interface Props {
  initialWhales: WhaleTraderSignal[];
}

export function WhaleRoster({ initialWhales }: Props) {
  const [whales, setWhales] = useState<WhaleTraderSignal[]>(initialWhales);
  const [tailSource, setTailSource] = useState<TailSource | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/whales/roster", { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as { whales: WhaleTraderSignal[] };
      setWhales(data.whales);
    } catch {
      // Keep the last good roster if the poll misses.
    }
  }, []);

  useVisiblePoll(load, POLL_MS);

  const ranked = useMemo(
    () => [...whales].sort((a, b) => b.heatScore - a.heatScore),
    [whales],
  );

  return (
    <div
      className="relative h-full w-full overflow-hidden lg:h-dvh"
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      <BalancePill />

      {ranked.length === 0 ? (
        <EmptyRoster />
      ) : (
        <div className="no-scrollbar h-full w-full snap-y snap-mandatory overflow-y-scroll">
          {ranked.map((whale, idx) => (
            <section
              key={whale.payload.whaleId}
              className="flex h-full w-full snap-start items-center justify-center px-3 pt-12 pb-24 lg:px-8 lg:py-8"
              style={{ scrollSnapStop: "always" }}
            >
              <WhaleCard
                whale={whale}
                rank={idx + 1}
                onTail={(source) => setTailSource(source)}
              />
            </section>
          ))}
        </div>
      )}

      <TailModal
        open={!!tailSource}
        source={tailSource}
        onClose={() => setTailSource(null)}
      />
    </div>
  );
}

function WhaleCard({
  whale,
  rank,
  onTail,
}: {
  whale: WhaleTraderSignal;
  rank: number;
  onTail: (source: TailSource) => void;
}) {
  const p = whale.payload;
  const exposureSummary = buildWhaleExposureSummary(p.openPositions);
  const fresh = !p.stale;
  const canTail = exposureSummary.copyableCount > 0;
  const totalPnl = p.stats.pnlAllTimeUsdc;
  const totalPnlColor = totalPnl >= 0 ? GREEN : RED;

  return (
    <article
      className="relative flex max-h-full w-full max-w-[460px] flex-col overflow-hidden px-4 pt-4 pb-3 lg:max-w-[520px]"
      style={{
        background: PANEL,
        borderRadius: 18,
        border: `1px solid ${fresh ? FAINT : `${RED}55`}`,
      }}
    >
      <div
        className="absolute top-0 left-0 rounded-br-xl px-2.5 py-1 text-[10px] font-black uppercase tracking-widest"
        style={{
          background: rank === 1 ? ACCENT : PANEL_2,
          color: rank === 1 ? BG : FG,
        }}
      >
        #{rank}
      </div>

      <div className="flex items-center gap-3 pl-8">
        <StoryAvatar
          emoji={p.displayName.slice(0, 1).toUpperCase()}
          imageUrl={p.avatarUrl}
          mood={fresh ? "HUNTING" : "WOUNDED"}
          size={48}
          pulse={fresh && p.openPositionsCount > 0}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate">
            <Headline size={24}>{p.displayName.toUpperCase()}</Headline>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
            <span>{p.source}</span>
            <span>{shortAccount(p.sourceAccount)}</span>
            <FreshnessBadge stale={p.stale} />
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
            Total P/L
          </div>
          <div className="mt-1 text-[34px] font-black tabular-nums leading-none" style={{ color: totalPnlColor }}>
            {formatSignedWhaleUsd(totalPnl)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
            Equity
          </div>
          <div className="mt-1 text-[18px] font-black tabular-nums" style={{ color: p.stats.equityUsdc > 0 ? FG : DIM }}>
            {p.stats.equityUsdc > 0 ? fmtUsd(p.stats.equityUsdc) : "N/A"}
          </div>
        </div>
      </div>

      <WhalePnlGraph
        points={p.stats.pnlCurve}
        totalPnl={totalPnl}
        positive={totalPnl >= 0}
      />

      <div className="mt-3 grid grid-cols-3 overflow-hidden border-y" style={{ borderColor: FAINT }}>
        <StatCell label="1D" value={formatSignedWhaleUsd(p.stats.pnl1dUsdc)} color={p.stats.pnl1dUsdc >= 0 ? GREEN : RED} />
        <StatCell label="7D" value={formatSignedWhaleUsd(p.stats.pnl7dUsdc)} color={p.stats.pnl7dUsdc >= 0 ? GREEN : RED} />
        <StatCell label="30D" value={formatSignedWhaleUsd(p.stats.pnl30dUsdc)} color={p.stats.pnl30dUsdc >= 0 ? GREEN : RED} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-black uppercase tracking-widest">
        <MiniMetric label="Open" value={String(exposureSummary.totalCount)} active={exposureSummary.totalCount > 0} />
        <MiniMetric label="Exposure" value={exposureSummary.exposureUsd > 0 ? fmtUsd(exposureSummary.exposureUsd) : "N/A"} active={exposureSummary.exposureUsd > 0} />
        <MiniMetric label="Vol 1D" value={p.stats.volume1dUsdc > 0 ? fmtUsd(p.stats.volume1dUsdc) : "N/A"} active={p.stats.volume1dUsdc > 0} />
      </div>

      <WhaleExposurePanel summary={exposureSummary} />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link
          href="/live"
          className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-black uppercase tracking-widest transition active:scale-[0.97]"
          style={{
            background: PANEL_2,
            color: FG,
            border: `1px solid ${FAINT}`,
          }}
        >
          <ArrowRight size={12} strokeWidth={3} />
          View positions
        </Link>
        <button
          type="button"
          disabled={!canTail}
          onClick={() => {
            const source = buildWhaleTailSource(p);
            if (!source) return;
            onTail(source);
          }}
          className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:cursor-not-allowed"
          style={{
            background: canTail ? ACCENT : "rgba(250,250,242,0.08)",
            color: canTail ? BG : DIM,
            boxShadow: canTail
              ? `0 3px 0 ${ACCENT}99, inset 0 -2px 0 rgba(0,0,0,0.15)`
              : "none",
          }}
        >
          <Zap size={12} strokeWidth={3} fill={canTail ? BG : "none"} />
          {canTail
            ? `Tail whale (${exposureSummary.copyableCount})`
            : "Unavailable"}
        </button>
      </div>
    </article>
  );
}

function WhalePnlGraph({
  points,
  totalPnl,
  positive,
}: {
  points: WhaleTraderSignal["payload"]["stats"]["pnlCurve"];
  totalPnl: number;
  positive: boolean;
}) {
  const width = 320;
  const height = 86;
  const path = buildPnlChartPath(points, width, height);
  const minValue = points.length > 0 ? Math.min(...points.map((p) => p.v)) : 0;
  const maxValue = points.length > 0 ? Math.max(...points.map((p) => p.v)) : 0;
  const valueSpan = Math.max(1, maxValue - minValue);
  const zeroY =
    minValue < 0 && maxValue > 0
      ? height - ((0 - minValue) / valueSpan) * height
      : null;
  const color = positive ? GREEN : RED;

  return (
    <div className="mt-3 overflow-hidden rounded-xl px-3 py-2.5" style={{ background: BG, border: `1px solid ${FAINT}` }}>
      <div className="mb-1.5 flex items-center justify-between text-[9px] font-black uppercase tracking-widest">
        <span style={{ color: DIM }}>All time P&L</span>
        <span style={{ color }}>{formatSignedWhaleUsd(totalPnl)}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block h-[86px] w-full"
        role="img"
        aria-label="All time P&L graph"
        preserveAspectRatio="none"
      >
        <rect x="0" y="0" width={width} height={height} fill="transparent" />
        {zeroY !== null ? (
          <line
            x1="0"
            x2={width}
            y1={zeroY}
            y2={zeroY}
            stroke={FAINT}
            strokeDasharray="4 4"
            strokeWidth="1"
          />
        ) : null}
        {path ? (
          <>
            <path
              d={`${path} L ${width.toFixed(2)} ${height.toFixed(2)} L 0.00 ${height.toFixed(2)} Z`}
              fill={color}
              opacity="0.12"
            />
            <path
              d={path}
              fill="none"
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : (
          <text
            x={width / 2}
            y={height / 2}
            dominantBaseline="middle"
            textAnchor="middle"
            fill={DIM}
            fontSize="22"
            fontWeight="900"
          >
            P&L HISTORY WARMING UP
          </text>
        )}
      </svg>
    </div>
  );
}

function WhaleExposurePanel({ summary }: { summary: WhaleExposureSummary }) {
  const largest = summary.largestPosition;
  const largestSideColor = largest?.side === "long" ? GREEN : RED;
  const largestPnl = largest?.unrealizedPnlPct ?? null;
  const largestProfit = (largestPnl ?? 0) >= 0;

  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: FAINT }}>
      <div className="mb-2 flex items-center justify-between text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
        <span>Current exposure</span>
        <span>{summary.copyableCount}/{summary.totalCount} copy ready</span>
      </div>

      {summary.totalCount === 0 ? (
        <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest" style={{ color: DIM }}>
          <Layers size={14} strokeWidth={2.8} />
          Watching for next open position
        </div>
      ) : (
        <div>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[26px] font-black tabular-nums leading-none">
                {summary.totalCount} OPEN
              </div>
              <div className="mt-1 text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                {summary.stanceLabel}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                Exposure
              </div>
              <div className="mt-1 text-[18px] font-black tabular-nums">
                {fmtUsd(summary.exposureUsd)}
              </div>
            </div>
          </div>

          {largest ? (
            <div className="mt-3 flex items-center justify-between gap-3 border-t pt-2" style={{ borderColor: FAINT }}>
              <div className="min-w-0">
                <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                  Largest
                </div>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] font-black uppercase tracking-widest">
                  <span>{largest.market}</span>
                  <span style={{ color: largestSideColor }}>{largest.side}</span>
                  <span style={{ color: DIM }}>{largest.leverage}x</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[11px] font-black uppercase tracking-widest tabular-nums" style={{ color: DIM }}>
                  {fmtUsd(largest.notionalUsd)}
                </div>
                <div
                  className="mt-1 text-[14px] font-black uppercase tracking-widest tabular-nums"
                  style={{ color: largestPnl === null ? DIM : largestProfit ? GREEN : RED }}
                >
                  {fmtPct(largestPnl)}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function MiniMetric({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <div className="min-w-0">
      <div style={{ color: DIM }}>{label}</div>
      <div className="mt-0.5 truncate tabular-nums" style={{ color: active ? FG : DIM }}>
        {value}
      </div>
    </div>
  );
}

function useVisiblePoll(load: () => Promise<void>, intervalMs: number) {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let inFlight = false;
    const run = () => {
      if (inFlight) return;
      inFlight = true;
      void load().finally(() => {
        inFlight = false;
      });
    };
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        run();
      }, intervalMs);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else start();
    };
    start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [load, intervalMs]);
}

function FreshnessBadge({ stale }: { stale: boolean }) {
  return (
    <span style={{ color: stale ? RED : GREEN }}>
      {stale ? "STALE" : "FRESH"}
    </span>
  );
}

function StatCell({
  label,
  value,
  color = FG,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="border-r px-2 py-2 text-center last:border-r-0" style={{ borderColor: FAINT }}>
      <div className="text-[8px] font-black uppercase tracking-widest" style={{ color: DIM }}>
        {label}
      </div>
      <div className="mt-0.5 text-[13px] font-black tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function EmptyRoster() {
  return (
    <div className="flex h-full min-h-[360px] flex-col items-center justify-center px-5 text-center">
      <Headline size={30}>{`"NO WHALES ONLINE"`}</Headline>
      <p className="mt-3 text-[12px] font-black uppercase tracking-widest" style={{ color: DIM }}>
        Waiting for source accounts to refresh
      </p>
    </div>
  );
}

function shortAccount(account: string): string {
  if (account.length <= 10) return account;
  return `${account.slice(0, 4)}...${account.slice(-4)}`;
}

function fmtUsd(v: number): string {
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(v: number | null): string {
  if (v === null) return "P/L N/A";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}
