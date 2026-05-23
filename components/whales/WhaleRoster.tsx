"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Radio, Zap } from "lucide-react";
import type { WhaleTraderSignal } from "@/lib/types";
import { BalancePill } from "@/components/shell/BalancePill";
import { TailModal, type TailSource } from "@/components/tail/TailModal";
import { buildPnlChartPath } from "./pnl-chart";
import { buildWhaleTailSource } from "./whale-tail-source";
import {
  ACCENT,
  BG,
  BigNum,
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

      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-5 pt-[72px] pb-28 lg:px-8 lg:pt-8 lg:pb-8">
        <header className="flex items-end justify-between gap-4 pb-4">
          <div>
            <Headline size={42}>{`"WHALES"`}</Headline>
            <p className="mt-1 text-[11px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              Ranked source accounts ready to copy
            </p>
          </div>
          <div
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest"
            style={{
              background: `${GREEN}18`,
              color: GREEN,
              border: `1px solid ${GREEN}40`,
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
              style={{ background: GREEN, boxShadow: `0 0 6px ${GREEN}` }}
            />
            LIVE
          </div>
        </header>

        <div className="no-scrollbar grid flex-1 auto-rows-max gap-3 overflow-y-auto lg:grid-cols-2 xl:grid-cols-3">
          {ranked.length === 0 ? (
            <EmptyRoster />
          ) : (
            ranked.map((whale, idx) => (
              <WhaleCard
                key={whale.payload.whaleId}
                whale={whale}
                rank={idx + 1}
                onTail={(source) => setTailSource(source)}
              />
            ))
          )}
        </div>
      </div>

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
  const copyablePositions = p.openPositions.filter((position) => !position.stale);
  const fresh = !p.stale;
  const canTail = copyablePositions.length > 0;
  const totalPnl = p.stats.pnlAllTimeUsdc;
  const totalPnlColor = totalPnl >= 0 ? GREEN : RED;
  const exposureUsd = p.openPositions.reduce(
    (sum, position) => sum + position.notionalUsd,
    0,
  );

  return (
    <article
      className="relative overflow-hidden px-4 pt-4 pb-3"
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
            {fmtSignedUsd(totalPnl)}
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
        <StatCell label="1D" value={fmtSignedUsd(p.stats.pnl1dUsdc)} color={p.stats.pnl1dUsdc >= 0 ? GREEN : RED} />
        <StatCell label="7D" value={fmtSignedUsd(p.stats.pnl7dUsdc)} color={p.stats.pnl7dUsdc >= 0 ? GREEN : RED} />
        <StatCell label="30D" value={fmtSignedUsd(p.stats.pnl30dUsdc)} color={p.stats.pnl30dUsdc >= 0 ? GREEN : RED} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-black uppercase tracking-widest">
        <MiniMetric label="Open" value={String(p.openPositionsCount)} active={p.openPositionsCount > 0} />
        <MiniMetric label="Exposure" value={exposureUsd > 0 ? fmtUsd(exposureUsd) : "N/A"} active={exposureUsd > 0} />
        <MiniMetric label="Vol 1D" value={p.stats.volume1dUsdc > 0 ? fmtUsd(p.stats.volume1dUsdc) : "N/A"} active={p.stats.volume1dUsdc > 0} />
      </div>

      {p.openPositions.length > 0 ? (
        <OpenPositionsStack positions={p.openPositions} />
      ) : (
        <div className="mt-3 flex items-center gap-2 border-t pt-3 text-[11px] font-black uppercase tracking-widest" style={{ borderColor: FAINT, color: DIM }}>
          <Radio size={14} strokeWidth={2.8} />
          Watching for next open position
        </div>
      )}

      <button
        type="button"
        disabled={!canTail}
        onClick={() => {
          const source = buildWhaleTailSource(p);
          if (!source) return;
          onTail(source);
        }}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:cursor-not-allowed"
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
          ? `TAIL WHALE (${copyablePositions.length})`
          : "TAIL UNAVAILABLE"}
      </button>
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
        <span style={{ color }}>{fmtSignedUsd(totalPnl)}</span>
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

function OpenPositionsStack({
  positions,
}: {
  positions: WhaleTraderSignal["payload"]["openPositions"];
}) {
  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: FAINT }}>
      <div className="mb-1 flex items-center justify-between text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
        <span>Open positions</span>
        <span>{positions.filter((position) => !position.stale).length}/{positions.length}</span>
      </div>
      <div className="space-y-2">
        {positions.map((position) => (
          <WhalePositionRow key={position.positionId} position={position} />
        ))}
      </div>
    </div>
  );
}

function WhalePositionRow({
  position,
}: {
  position: WhaleTraderSignal["payload"]["openPositions"][number];
}) {
  const sideColor = position.side === "long" ? GREEN : RED;
  const pnl = position.unrealizedPnlPct;
  const profit = (pnl ?? 0) >= 0;

  return (
    <div
      className="rounded-xl px-2.5 py-2"
      style={{
        background: PANEL_2,
        border: `1px solid ${position.stale ? `${RED}40` : FAINT}`,
      }}
    >
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-1.5">
            <BigNum size={21}>{position.market}</BigNum>
            <span className="rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide" style={{ background: `${sideColor}22`, color: sideColor }}>
              {position.side}
            </span>
            <span className="text-[11px] font-black" style={{ color: DIM }}>{position.leverage}x</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
            <span>Entry {fmtPrice(position.entryPrice)}</span>
            <span>Mark {position.currentMark === null ? "N/A" : fmtPrice(position.currentMark)}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[11px] font-black uppercase tracking-widest tabular-nums" style={{ color: DIM }}>
            {fmtUsd(position.notionalUsd)}
          </div>
          <div
            className="mt-1 text-[14px] font-black uppercase tracking-widest tabular-nums"
            style={{ color: pnl === null ? DIM : profit ? GREEN : RED }}
          >
            {fmtPct(pnl)}
          </div>
          <div
            className="mt-1 text-[9px] font-black uppercase tracking-widest"
            style={{ color: position.stale ? RED : GREEN }}
          >
            {position.stale ? "STALE" : "COPY READY"}
          </div>
        </div>
      </div>
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
    <div className="col-span-full flex h-full min-h-[360px] flex-col items-center justify-center text-center">
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

function fmtSignedUsd(v: number): string {
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(v).toFixed(0)}`;
}

function fmtPct(v: number | null): string {
  if (v === null) return "P/L N/A";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function fmtPrice(v: number): string {
  if (v >= 1000) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toPrecision(4)}`;
}
