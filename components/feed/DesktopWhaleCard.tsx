"use client";

// The classic desktop whale grid card, resurrected from the old WhaleRoster
// (deleted in 8287fbd) on founder feedback: "return the old cards on
// desktop". Visual identity is kept verbatim — rank chip, fingerprint
// avatar + LIVE/DELAYED source row, Total P/L + Equity + Open, the all-time
// P&L graph, 1D/7D/30D cells, the exposure summary with the largest
// position, and the Tail CTA.
//
// Two deliberate departures from the original, both dead surfaces:
//   - no "Positions" link (it pointed at the deleted tape route), so Tail
//     is the single full-width CTA;
//   - no heat anywhere — `rank` comes from the unified feed's P&L ranking.
// `now` is the feed's shared 1s ticker instead of a per-card interval.

import { Layers, Zap } from "lucide-react";
import type { WhaleTraderSignal } from "@/lib/types";
import { isSourceFresh } from "@/lib/whales/identity";
import type { TailSource } from "@/components/tail/TailModal";
import { buildWhaleTailSource } from "@/components/whales/whale-tail-source";
import { WhaleFingerprintAvatar } from "@/components/whales/WhaleFingerprintAvatar";
import { formatSignedWhaleUsd } from "@/components/whales/whale-money";
import { formatWhalePositionTime } from "@/components/whales/whale-position-age";
import { whaleDisplayName } from "@/lib/whales/alias";
import {
  buildPnlChartPath,
  buildWhaleExposureSummary,
} from "./desktop-card-helpers";
import {
  ACCENT,
  BG,
  DIM,
  FAINT,
  FG,
  GREEN,
  PANEL,
  PANEL_2,
  RED,
  STREAK,
} from "@/components/v2/ui";

export function DesktopWhaleCard({
  whale,
  rank,
  now,
  onTail,
  onCopy,
}: {
  whale: WhaleTraderSignal;
  rank: number;
  now: number;
  onTail: (source: TailSource) => void;
  /** Standing auto-copy (Copy modal) — armed flat or live. */
  onCopy?: (target: {
    kind: "whale";
    key: string;
    label: string;
    emoji?: string;
  }) => void;
}) {
  const p = whale.payload;
  const displayName = whaleDisplayName(p.displayName, p.sourceAccount);
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
          label={displayName}
          mood={fresh ? "HUNTING" : "WOUNDED"}
          size={44}
          pulse={fresh && p.openPositionsCount > 0}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[18px] font-black uppercase leading-none">
            {displayName}
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

      {/* CTA row: Tail (live positions) + Copy (standing auto-copy; works
          even while the whale is flat — arming for the NEXT open is the
          point). */}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={!canTail}
          onClick={() => {
            const source = buildWhaleTailSource(p, now);
            if (!source) return;
            onTail(source);
          }}
          className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[10px] font-black uppercase tracking-widest transition hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed"
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
        {onCopy ? (
          <button
            type="button"
            onClick={() =>
              onCopy({
                kind: "whale",
                key: `${p.source}:${p.sourceAccount}`,
                label: p.displayName,
                emoji: "🐋",
              })
            }
            className="shrink-0 rounded-xl border px-3 py-2.5 text-[10px] font-black uppercase tracking-widest transition hover:opacity-90 active:scale-[0.97]"
            style={{
              background: "rgba(250,250,242,0.04)",
              borderColor: FAINT,
              color: FG,
            }}
          >
            Copy
          </button>
        ) : null}
      </div>
    </article>
  );
}

/** Grid-shaped loading placeholder, same as the old roster's desktop grid. */
export function SkeletonDesktopWhaleCard() {
  return (
    <div
      className="w-full rounded-lg border p-4"
      style={{ background: PANEL, borderColor: FAINT }}
      aria-hidden
    >
      <div className="flex items-center gap-3">
        <div className="skeleton-block h-11 w-11 rounded-full" />
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
      <div className="skeleton-block mt-4 h-11 w-full rounded-xl" />
    </div>
  );
}

function WhalePnlGraph({
  points,
  positive,
  historyLabel,
  historyValue,
  unavailableLabel,
}: {
  points: WhaleTraderSignal["payload"]["stats"]["pnlCurve"];
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
    <div
      className="mt-3 overflow-hidden rounded-xl px-3 py-2.5"
      style={{ background: BG, border: `1px solid ${FAINT}` }}
    >
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

function FreshnessBadge({ stale }: { stale: boolean }) {
  // "Delayed" = our snapshot of this whale is aging, not that the trade is
  // dead — amber, not alarm-red.
  return (
    <span
      className="inline-flex items-center gap-1"
      style={{ color: stale ? STREAK : GREEN }}
    >
      {!stale && (
        <span
          className="h-1.5 w-1.5 animate-pulse rounded-full"
          style={{ background: GREEN }}
          aria-hidden
        />
      )}
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
    <div
      className="border-r px-2 py-2 text-center last:border-r-0"
      style={{ borderColor: FAINT }}
    >
      <div
        className="text-[8px] font-black uppercase tracking-widest"
        style={{ color: DIM }}
      >
        {label}
      </div>
      <div className="mt-0.5 text-[13px] font-black tabular-nums" style={{ color }}>
        {value}
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
      <div
        className="mt-0.5 truncate tabular-nums"
        style={{ color: active ? FG : DIM }}
      >
        {value}
      </div>
    </div>
  );
}

function shortAccount(account: string): string {
  if (account.length <= 10) return account;
  return `${account.slice(0, 4)}...${account.slice(-4)}`;
}

function fmtUsd(v: number): string {
  // Compact at feed scale — $92,227,195 is noise, $92.2M is a number.
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${trimCompact(abs / 1_000_000, 1)}M`;
  if (abs >= 10_000) return `$${trimCompact(abs / 1_000, 1)}K`;
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
  return hasPortfolioStats ? formatCompactSignedWhaleUsd(value) : "N/A";
}

function periodPnlColor(value: number, hasPortfolioStats: boolean): string {
  if (!hasPortfolioStats) return DIM;
  return value >= 0 ? GREEN : RED;
}
