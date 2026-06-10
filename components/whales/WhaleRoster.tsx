"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Layers, Zap } from "lucide-react";
import type { WhaleTraderSignal } from "@/lib/types";
import { isSourceFresh } from "@/lib/whales/identity";
import { BalancePill } from "@/components/shell/BalancePill";
import { TailModal, type TailSource } from "@/components/tail/TailModal";
import { buildPnlChartPath } from "./pnl-chart";
import { formatSignedWhaleUsd } from "./whale-money";
import { formatWhalePositionTime } from "./whale-position-age";
import { buildWhaleTailSource } from "./whale-tail-source";
import { WhaleFingerprintAvatar } from "./WhaleFingerprintAvatar";
import { WhaleViewSwitch } from "./WhaleViewSwitch";
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
  STREAK,
} from "@/components/v2/ui";

const POLL_MS = 30_000;

type RosterSortKey = "heat" | "pnl1d" | "pnl7d" | "pnl30d" | "equity";
type RosterSourceFilter = "all" | "pacifica" | "hyperliquid";

const ROSTER_SORTERS: Record<
  RosterSortKey,
  (w: WhaleTraderSignal) => number
> = {
  heat: (w) => w.heatScore,
  pnl1d: (w) => w.payload.stats.pnl1dUsdc,
  pnl7d: (w) => w.payload.stats.pnl7dUsdc,
  pnl30d: (w) => w.payload.stats.pnl30dUsdc,
  equity: (w) => w.payload.stats.equityUsdc,
};

const ROSTER_SORT_OPTIONS: { key: RosterSortKey; label: string }[] = [
  // "Hot", not "Heat" — the Heat *view* chip sits right next to this group.
  { key: "heat", label: "Hot" },
  { key: "pnl1d", label: "1D" },
  { key: "pnl7d", label: "7D" },
  { key: "pnl30d", label: "30D" },
  { key: "equity", label: "Equity" },
];

const ROSTER_SOURCE_OPTIONS: { key: RosterSourceFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pacifica", label: "PAC" },
  { key: "hyperliquid", label: "HL" },
];

interface Props {
  initialWhales: WhaleTraderSignal[];
}

export function WhaleRoster({ initialWhales }: Props) {
  const [whales, setWhales] = useState<WhaleTraderSignal[]>(initialWhales);
  const [loaded, setLoaded] = useState(initialWhales.length > 0);
  const [tailSource, setTailSource] = useState<TailSource | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/whales/roster", { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as { whales: WhaleTraderSignal[] };
      setWhales((current) =>
        shouldUseRosterRefresh(data.whales, current) ? data.whales : current,
      );
    } catch {
      // Keep the last good roster if the poll misses.
    } finally {
      setLoaded(true);
    }
  }, []);

  useVisiblePoll(load, POLL_MS);

  const [sortKey, setSortKey] = useState<RosterSortKey>("heat");
  const [sourceFilter, setSourceFilter] = useState<RosterSourceFilter>("all");

  const ranked = useMemo(() => {
    const filtered =
      sourceFilter === "all"
        ? whales
        : whales.filter((w) => w.payload.source === sourceFilter);
    const value = ROSTER_SORTERS[sortKey];
    return [...filtered].sort((a, b) => value(b) - value(a));
  }, [whales, sortKey, sourceFilter]);

  return (
    <div
      className="relative h-full w-full overflow-hidden lg:h-dvh"
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      <BalancePill />

      {/* Mobile wayfinding: view switch + sort, one swipeable strip. */}
      <div className="no-scrollbar absolute top-[52px] left-0 right-0 z-30 flex items-center gap-2 overflow-x-auto px-3 pb-1 lg:hidden">
        <WhaleViewSwitch active="roster" className="shrink-0" />
        <RosterSortChips sortKey={sortKey} onChange={setSortKey} />
      </div>

      {!loaded && ranked.length === 0 ? (
        <LoadingRoster />
      ) : whales.length === 0 ? (
        <EmptyRoster />
      ) : ranked.length === 0 ? (
        <FilteredEmpty onReset={() => setSourceFilter("all")} />
      ) : (
        <>
          <div className="no-scrollbar h-full w-full snap-y snap-mandatory overflow-y-scroll lg:hidden">
            {ranked.map((whale, idx) => (
              <section
                key={whale.payload.whaleId}
                className="flex h-full w-full snap-start items-center justify-center px-3 pt-24 pb-24"
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

          <div className="hidden h-full min-h-0 flex-col lg:flex">
            <div
              className="flex flex-none items-center justify-between gap-4 border-b px-6 py-4"
              style={{ borderColor: FAINT }}
            >
              <div>
                <div
                  className="text-[10px] font-black uppercase tracking-[0.24em]"
                  style={{ color: DIM }}
                >
                  COPYABLE WHALE ACCOUNTS
                </div>
                <div className="mt-1 text-[22px] font-black uppercase leading-none">
                  {ranked.length} sources online
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <WhaleViewSwitch active="roster" />
                <RosterSortChips sortKey={sortKey} onChange={setSortKey} />
                <RosterSourceChips
                  sourceFilter={sourceFilter}
                  onChange={setSourceFilter}
                />
              </div>
            </div>

            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="grid auto-rows-max grid-cols-2 gap-3 xl:grid-cols-3">
                {ranked.map((whale, idx) => (
                  <DesktopWhaleCard
                    key={whale.payload.whaleId}
                    whale={whale}
                    rank={idx + 1}
                    onTail={(source) => setTailSource(source)}
                  />
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <TailModal
        open={!!tailSource}
        source={tailSource}
        onClose={() => setTailSource(null)}
      />
    </div>
  );
}

function shouldUseRosterRefresh(
  next: WhaleTraderSignal[],
  current: WhaleTraderSignal[],
): boolean {
  if (current.length === 0) return true;
  if (next.length === 0) return false;

  const currentHasOpenPositions = current.some(
    (whale) => whale.payload.openPositionsCount > 0,
  );
  const nextHasOpenPositions = next.some(
    (whale) => whale.payload.openPositionsCount > 0,
  );

  if (
    currentHasOpenPositions &&
    !nextHasOpenPositions &&
    next.every((whale) => whale.payload.stale)
  ) {
    return false;
  }

  return true;
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
  const [now, setNow] = useState(0);
  const exposureSummary = buildWhaleExposureSummary(p.openPositions, now);
  const lastSeenAtMs = p.lastSeenAt === null ? null : Date.parse(p.lastSeenAt);
  const fresh =
    now > 0 &&
    !p.stale &&
    lastSeenAtMs !== null &&
    Number.isFinite(lastSeenAtMs) &&
    isSourceFresh(lastSeenAtMs, undefined, now);
  const canTail = exposureSummary.copyableCount > 0;
  const livePositionStatsOnly = p.stats.statsSource === "live_positions";
  const hasPortfolioStats = !livePositionStatsOnly;
  const totalPnl = p.stats.pnlAllTimeUsdc;
  const totalPnlColor = totalPnl >= 0 ? GREEN : RED;

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <article
      className="relative flex max-h-full w-full max-w-[460px] flex-col overflow-hidden px-4 pt-4 pb-3 lg:max-w-[520px]"
      style={{
        background: PANEL,
        borderRadius: 18,
        border: `1px solid ${fresh ? FAINT : `${STREAK}45`}`,
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
        <WhaleFingerprintAvatar
          sourceAccount={p.sourceAccount}
          label={p.displayName}
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
            {livePositionStatsOnly ? "Live P/L" : "Total P/L"}
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
        historyLabel={livePositionStatsOnly ? "P&L history" : "All time P&L"}
        historyValue={
          livePositionStatsOnly ? "N/A" : formatSignedWhaleUsd(totalPnl)
        }
        unavailableLabel={
          livePositionStatsOnly
            ? "P&L HISTORY UNAVAILABLE"
            : "P&L HISTORY WARMING UP"
        }
      />

      <div className="mt-3 grid grid-cols-3 overflow-hidden border-y" style={{ borderColor: FAINT }}>
        <StatCell label="1D" value={formatPeriodPnl(p.stats.pnl1dUsdc, hasPortfolioStats)} color={periodPnlColor(p.stats.pnl1dUsdc, hasPortfolioStats)} />
        <StatCell label="7D" value={formatPeriodPnl(p.stats.pnl7dUsdc, hasPortfolioStats)} color={periodPnlColor(p.stats.pnl7dUsdc, hasPortfolioStats)} />
        <StatCell label="30D" value={formatPeriodPnl(p.stats.pnl30dUsdc, hasPortfolioStats)} color={periodPnlColor(p.stats.pnl30dUsdc, hasPortfolioStats)} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-black uppercase tracking-widest">
        <MiniMetric label="Open" value={String(exposureSummary.totalCount)} active={exposureSummary.totalCount > 0} />
        <MiniMetric label="Exposure" value={exposureSummary.exposureUsd > 0 ? fmtUsd(exposureSummary.exposureUsd) : "N/A"} active={exposureSummary.exposureUsd > 0} />
        <MiniMetric label="Vol 1D" value={p.stats.volume1dUsdc > 0 ? fmtUsd(p.stats.volume1dUsdc) : "N/A"} active={p.stats.volume1dUsdc > 0} />
      </div>

      <WhaleExposurePanel summary={exposureSummary} now={now} />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link
          href="/live"
          prefetch={false}
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
            const source = buildWhaleTailSource(p, now);
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

function DesktopWhaleCard({
  whale,
  rank,
  onTail,
}: {
  whale: WhaleTraderSignal;
  rank: number;
  onTail: (source: TailSource) => void;
}) {
  const p = whale.payload;
  const [now, setNow] = useState(0);
  const exposureSummary = buildWhaleExposureSummary(p.openPositions, now);
  const lastSeenAtMs = p.lastSeenAt === null ? null : Date.parse(p.lastSeenAt);
  const fresh =
    now > 0 &&
    !p.stale &&
    lastSeenAtMs !== null &&
    Number.isFinite(lastSeenAtMs) &&
    isSourceFresh(lastSeenAtMs, undefined, now);
  const livePositionStatsOnly = p.stats.statsSource === "live_positions";
  const hasPortfolioStats = !livePositionStatsOnly;
  const totalPnl = p.stats.pnlAllTimeUsdc;
  const totalPnlColor = totalPnl >= 0 ? GREEN : RED;
  const largest = exposureSummary.largestPosition;
  const largestTime = largest ? formatWhalePositionTime(largest, now) : null;
  const largestPnl = largest?.unrealizedPnlPct ?? null;
  const largestPnlColor =
    largestPnl === null ? DIM : largestPnl >= 0 ? GREEN : RED;
  const largestSideColor = largest?.side === "long" ? GREEN : RED;
  const canTail = exposureSummary.copyableCount > 0;

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <article
      className="card-hover relative flex min-h-[420px] flex-col overflow-hidden p-4"
      style={{
        background: PANEL,
        borderRadius: 8,
        border: `1px solid ${fresh ? FAINT : `${STREAK}45`}`,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-black uppercase tracking-widest"
          style={{
            background: rank === 1 ? ACCENT : PANEL_2,
            color: rank === 1 ? BG : FG,
          }}
        >
          #{rank}
        </div>
        <WhaleFingerprintAvatar
          sourceAccount={p.sourceAccount}
          label={p.displayName}
          mood={fresh ? "HUNTING" : "WOUNDED"}
          size={44}
          pulse={fresh && p.openPositionsCount > 0}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[18px] font-black uppercase leading-none">
            {p.displayName}
          </div>
          <div
            className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            <span>{p.source}</span>
            <span>{shortAccount(p.sourceAccount)}</span>
            <FreshnessBadge stale={p.stale} />
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div>
          <div
            className="text-[8px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            {livePositionStatsOnly ? "Live P/L" : "Total P/L"}
          </div>
          <div
            className="mt-1 truncate text-[21px] font-black tabular-nums leading-none"
            style={{ color: totalPnlColor }}
          >
            {formatCompactSignedWhaleUsd(totalPnl)}
          </div>
        </div>
        <MiniMetric
          label="Equity"
          value={p.stats.equityUsdc > 0 ? fmtUsd(p.stats.equityUsdc) : "N/A"}
          active={p.stats.equityUsdc > 0}
        />
        <MiniMetric
          label="Open"
          value={String(exposureSummary.totalCount)}
          active={exposureSummary.totalCount > 0}
        />
      </div>

      <WhalePnlGraph
        points={p.stats.pnlCurve}
        totalPnl={totalPnl}
        positive={totalPnl >= 0}
        historyLabel={livePositionStatsOnly ? "P&L history" : "All time P&L"}
        historyValue={
          livePositionStatsOnly ? "N/A" : formatSignedWhaleUsd(totalPnl)
        }
        unavailableLabel={
          livePositionStatsOnly
            ? "P&L HISTORY UNAVAILABLE"
            : "P&L HISTORY WARMING UP"
        }
      />

      <div
        className="mt-3 grid grid-cols-3 overflow-hidden border-y"
        style={{ borderColor: FAINT }}
      >
        <StatCell
          label="1D"
          value={formatPeriodPnl(p.stats.pnl1dUsdc, hasPortfolioStats)}
          color={periodPnlColor(p.stats.pnl1dUsdc, hasPortfolioStats)}
        />
        <StatCell
          label="7D"
          value={formatPeriodPnl(p.stats.pnl7dUsdc, hasPortfolioStats)}
          color={periodPnlColor(p.stats.pnl7dUsdc, hasPortfolioStats)}
        />
        <StatCell
          label="30D"
          value={formatPeriodPnl(p.stats.pnl30dUsdc, hasPortfolioStats)}
          color={periodPnlColor(p.stats.pnl30dUsdc, hasPortfolioStats)}
        />
      </div>

      <div className="mt-3 flex-1 border-t pt-3" style={{ borderColor: FAINT }}>
        <div
          className="mb-2 flex items-center justify-between text-[9px] font-black uppercase tracking-widest"
          style={{ color: DIM }}
        >
          <span>Exposure</span>
          <span>{exposureSummary.copyableCount} copy ready</span>
        </div>

        {largest ? (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] font-black uppercase tracking-widest">
                <span>{largest.market}</span>
                <span style={{ color: largestSideColor }}>{largest.side}</span>
                <span style={{ color: DIM }}>{largest.leverage}x</span>
              </div>
              <div
                className="mt-1 text-[9px] font-black uppercase tracking-widest"
                style={{ color: DIM }}
              >
                {largestTime?.label === "Seen" ? "Seen" : "Held"}{" "}
                {largestTime?.value}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[12px] font-black tabular-nums">
                {fmtUsd(largest.notionalUsd)}
              </div>
              <div
                className="mt-1 text-[12px] font-black uppercase tracking-widest tabular-nums"
                style={{ color: largestPnlColor }}
              >
                {fmtPct(largestPnl)}
              </div>
            </div>
          </div>
        ) : (
          <div
            className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            <Layers size={14} strokeWidth={2.8} />
            Watching for next open position
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link
          href="/live?mode=swipe"
          prefetch={false}
          className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[10px] font-black uppercase tracking-widest transition hover:opacity-90 active:scale-[0.97]"
          style={{
            background: PANEL_2,
            color: FG,
            border: `1px solid ${FAINT}`,
          }}
        >
          <ArrowRight size={12} strokeWidth={3} />
          Positions
        </Link>
        <button
          type="button"
          disabled={!canTail}
          onClick={() => {
            const source = buildWhaleTailSource(p, now);
            if (!source) return;
            onTail(source);
          }}
          className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[10px] font-black uppercase tracking-widest transition hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed"
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
            ? `Tail ${exposureSummary.copyableCount} position${
                exposureSummary.copyableCount === 1 ? "" : "s"
              }`
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
  historyLabel,
  historyValue,
  unavailableLabel,
}: {
  points: WhaleTraderSignal["payload"]["stats"]["pnlCurve"];
  totalPnl: number;
  positive: boolean;
  historyLabel: string;
  historyValue: string;
  unavailableLabel: string;
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
        <span style={{ color: DIM }}>{historyLabel}</span>
        <span style={{ color }}>{historyValue}</span>
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
            {unavailableLabel}
          </text>
        )}
      </svg>
    </div>
  );
}

function WhaleExposurePanel({
  summary,
  now,
}: {
  summary: WhaleExposureSummary;
  now: number;
}) {
  const largest = summary.largestPosition;
  const largestSideColor = largest?.side === "long" ? GREEN : RED;
  const largestPnl = largest?.unrealizedPnlPct ?? null;
  const largestProfit = (largestPnl ?? 0) >= 0;
  const largestTime = largest ? formatWhalePositionTime(largest, now) : null;

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
                <div className="mt-1 text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                  {largestTime?.label === "Seen" ? "Seen" : "Held"} {largestTime?.value}
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
      if (typeof document === "undefined" || !document.hidden) run();
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
  // "Delayed" = our snapshot of this whale is aging, not that the trade is
  // dead — amber, not alarm-red.
  return (
    <span style={{ color: stale ? STREAK : GREEN }}>
      {stale ? "DELAYED" : "LIVE"}
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

function LoadingRoster() {
  return (
    <>
      {/* Mobile: one card-shaped skeleton where the first whale will land. */}
      <div className="flex h-full w-full items-center justify-center px-3 pt-12 pb-24 lg:hidden">
        <SkeletonWhaleCard />
      </div>
      {/* Desktop: a grid of skeletons matching the real layout. */}
      <div className="hidden h-full min-h-0 flex-col px-6 pt-6 lg:flex">
        <div className="mb-5 space-y-2">
          <div className="skeleton-block h-3 w-44 rounded-md" />
          <div className="skeleton-block h-7 w-64 rounded-md" />
        </div>
        <div className="grid grid-cols-2 gap-3 overflow-hidden xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonWhaleCard key={i} />
          ))}
        </div>
      </div>
    </>
  );
}

function RosterSortChips({
  sortKey,
  onChange,
}: {
  sortKey: RosterSortKey;
  onChange: (key: RosterSortKey) => void;
}) {
  return (
    <div
      className="inline-flex shrink-0 items-center gap-1 rounded-full border p-1"
      style={{ background: PANEL, borderColor: FAINT }}
      role="group"
      aria-label="Sort whales"
    >
      {ROSTER_SORT_OPTIONS.map((option) => {
        const active = option.key === sortKey;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            aria-pressed={active}
            className="rounded-full px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest transition active:scale-[0.97]"
            style={{
              background: active ? PANEL_2 : "transparent",
              color: active ? FG : DIM,
              border: `1px solid ${active ? FAINT : "transparent"}`,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function RosterSourceChips({
  sourceFilter,
  onChange,
}: {
  sourceFilter: RosterSourceFilter;
  onChange: (key: RosterSourceFilter) => void;
}) {
  return (
    <div
      className="inline-flex shrink-0 items-center gap-1 rounded-full border p-1"
      style={{ background: PANEL, borderColor: FAINT }}
      role="group"
      aria-label="Filter by source"
    >
      {ROSTER_SOURCE_OPTIONS.map((option) => {
        const active = option.key === sourceFilter;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            aria-pressed={active}
            className="rounded-full px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest transition active:scale-[0.97]"
            style={{
              background: active ? PANEL_2 : "transparent",
              color: active ? FG : DIM,
              border: `1px solid ${active ? FAINT : "transparent"}`,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function FilteredEmpty({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex h-full min-h-[360px] flex-col items-center justify-center px-5 text-center">
      <Headline size={26}>{`"NO WHALES HERE"`}</Headline>
      <p
        className="mt-3 text-[12px] font-black uppercase tracking-widest"
        style={{ color: DIM }}
      >
        Nothing from this source right now
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-5 rounded-2xl px-5 py-2.5 text-[11px] font-black uppercase tracking-widest transition active:scale-[0.97]"
        style={{ background: ACCENT, color: BG }}
      >
        Show all sources
      </button>
    </div>
  );
}

function SkeletonWhaleCard() {
  return (
    <div
      className="w-full max-w-[520px] rounded-3xl border p-5"
      style={{ background: PANEL, borderColor: FAINT }}
      aria-hidden
    >
      <div className="flex items-center gap-3">
        <div className="skeleton-block h-12 w-12 rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="skeleton-block h-4 w-2/5 rounded-md" />
          <div className="skeleton-block h-3 w-3/5 rounded-md" />
        </div>
      </div>
      <div className="mt-5 flex items-end justify-between">
        <div className="skeleton-block h-9 w-2/5 rounded-md" />
        <div className="skeleton-block h-5 w-1/4 rounded-md" />
      </div>
      <div className="skeleton-block mt-4 h-24 w-full rounded-2xl" />
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="skeleton-block h-10 rounded-xl" />
        <div className="skeleton-block h-10 rounded-xl" />
        <div className="skeleton-block h-10 rounded-xl" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="skeleton-block h-11 rounded-xl" />
        <div className="skeleton-block h-11 rounded-xl" />
      </div>
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

function formatCompactSignedWhaleUsd(value: number): string {
  const sign = value >= 0 ? "+" : "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${trimCompact(abs / 1_000_000, 1)}M`;
  if (abs >= 1_000) {
    const digits = abs >= 100_000 ? 0 : 1;
    return `${sign}$${trimCompact(abs / 1_000, digits)}K`;
  }
  return formatSignedWhaleUsd(value);
}

function trimCompact(value: number, maximumFractionDigits: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  });
}

function fmtPct(v: number | null): string {
  if (v === null) return "P/L N/A";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function formatPeriodPnl(value: number, hasPortfolioStats: boolean): string {
  return hasPortfolioStats ? formatSignedWhaleUsd(value) : "N/A";
}

function periodPnlColor(value: number, hasPortfolioStats: boolean): string {
  if (!hasPortfolioStats) return DIM;
  return value >= 0 ? GREEN : RED;
}
