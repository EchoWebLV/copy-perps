"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
  Crown,
  Flame,
  Gauge,
  Trophy,
} from "lucide-react";
import type { WhalePositionSignal } from "@/lib/types";
import type { MarketSentiment } from "@/lib/data/market-sentiment";
import { isSourceFresh } from "@/lib/whales/identity";
import {
  ACCENT,
  BG,
  DIM,
  FAINT,
  FG,
  FONT_BODY,
  FONT_DISPLAY,
  GREEN,
  PANEL,
  PANEL_2,
  RED,
} from "@/components/v2/ui";
import { WhaleFingerprintAvatar } from "./WhaleFingerprintAvatar";
import { formatWhalePositionAge } from "./whale-position-age";

const POLL_MS = 10_000;
const SENTIMENT_POLL_MS = 30_000;
const SENTIMENT_MARKET_LIMIT = 20;
const PINNED_MARKET_ORDER = [
  "BTC",
  "ETH",
  "SOL",
  "HYPE",
  "XRP",
  "DOGE",
  "BNB",
  "AVAX",
] as const;
const PINNED_MARKET_RANK = new Map<string, number>(
  PINNED_MARKET_ORDER.map((market, index) => [market, index]),
);

type WhalePosition = WhalePositionSignal["payload"];

interface Props {
  initialPositions: WhalePositionSignal[];
}

interface TopWhale {
  whaleId: string;
  displayName: string;
  sourceAccount: string;
  source: WhalePosition["source"];
  notionalUsd: number;
  longNotional: number;
  shortNotional: number;
  positionCount: number;
}

interface MarketHeatRow {
  market: string;
  positions: WhalePosition[];
  whaleCount: number;
  totalNotional: number;
  longNotional: number;
  shortNotional: number;
  netNotional: number;
  longPct: number;
  shortPct: number;
  bias: "long" | "short" | "balanced";
  topWhale: TopWhale;
  biggestPosition: WhalePosition;
  newestOpen: WhalePosition;
  strongestPnl: WhalePosition | null;
}

interface MarketHeatDisplay {
  totalNotional: number;
  longNotional: number;
  shortNotional: number;
  netNotional: number;
  longPct: number;
  shortPct: number;
  bias: MarketHeatRow["bias"];
  sourceLabel: string;
  longLabel: string;
  shortLabel: string;
}

export function WhaleMarketHeatmap({ initialPositions }: Props) {
  const [positions, setPositions] =
    useState<WhalePositionSignal[]>(initialPositions);
  const [sentimentByMarket, setSentimentByMarket] = useState<
    Record<string, MarketSentiment>
  >({});
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/whales/live?limit=1000", {
        cache: "no-store",
      });
      if (!r.ok) return;
      const data = (await r.json()) as { positions: WhalePositionSignal[] };
      setPositions((current) =>
        data.positions.length > 0 || current.length === 0
          ? data.positions
          : current,
      );
    } catch {
      // Keep the current heatmap visible if a refresh misses.
    }
  }, []);

  useVisiblePoll(load, POLL_MS);

  const rows = useMemo(
    () => buildMarketHeatRows(positions, now),
    [now, positions],
  );
  const sentimentMarketsParam = useMemo(
    () =>
      rows
        .slice(0, SENTIMENT_MARKET_LIMIT)
        .map((row) => encodeURIComponent(row.market))
        .join(","),
    [rows],
  );

  const loadSentiment = useCallback(async () => {
    if (!sentimentMarketsParam) return;
    try {
      const r = await fetch(
        `/api/markets/sentiment?markets=${sentimentMarketsParam}`,
        { cache: "no-store" },
      );
      if (!r.ok) return;
      const data = (await r.json()) as {
        sentiment: Record<string, MarketSentiment>;
      };
      setSentimentByMarket((current) => ({
        ...current,
        ...data.sentiment,
      }));
    } catch {
      // Keep tracked-whale heat visible if the public sentiment feed misses.
    }
  }, [sentimentMarketsParam]);

  useEffect(() => {
    void loadSentiment();
  }, [loadSentiment]);

  useVisiblePoll(loadSentiment, SENTIMENT_POLL_MS);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const displayRows = useMemo(
    () =>
      rows.map((row) => ({
        row,
        heat: getMarketHeatDisplay(row, sentimentByMarket[row.market]),
      })),
    [rows, sentimentByMarket],
  );
  const summary = useMemo(() => buildHeatSummary(displayRows), [displayRows]);

  return (
    <div
      className="relative h-full w-full overflow-hidden lg:h-dvh"
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      <div className="no-scrollbar h-full overflow-y-auto px-4 pb-28 pt-5 sm:px-6 lg:pb-10 lg:pl-7 lg:pr-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-center gap-3">
              <span
                className="flex h-12 w-12 items-center justify-center rounded-full border-2"
                style={{
                  borderColor: ACCENT,
                  background: PANEL,
                  color: ACCENT,
                }}
              >
                <Flame size={24} strokeWidth={2.8} />
              </span>
              <div>
                <div className="text-[34px] font-black uppercase leading-none sm:text-[42px]">
                  HEAT
                </div>
                <div
                  className="mt-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em]"
                  style={{ color: DIM }}
                >
                  <Activity size={13} />
                  Public positioning
                </div>
              </div>
            </div>
            <div
              className="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em]"
              style={{
                borderColor: FAINT,
                background: PANEL,
                color: ACCENT,
              }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: GREEN }} />
              Refreshing
            </div>
          </header>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SummaryTile label="Markets" value={String(summary.marketCount)} />
            <SummaryTile
              label="Long"
              value={formatUsd(summary.longNotional)}
              color={GREEN}
            />
            <SummaryTile
              label="Short"
              value={formatUsd(summary.shortNotional)}
              color={RED}
            />
            <SummaryTile
              label="Net"
              value={formatSignedUsd(summary.netNotional)}
              color={summary.netNotional >= 0 ? GREEN : RED}
            />
          </div>

          {rows.length === 0 ? (
            <EmptyHeat />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {displayRows.map(({ row, heat }) => (
                <MarketHeatCard
                  key={row.market}
                  row={row}
                  heat={heat}
                  now={now}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function buildMarketHeatRows(
  signals: WhalePositionSignal[],
  nowMs = Date.now(),
): MarketHeatRow[] {
  const byMarket = new Map<string, WhalePosition[]>();

  for (const signal of signals) {
    const position = signal.payload;
    if (!isLiveHeatPosition(position, nowMs)) continue;
    const market = normalizeMarket(position.market);
    const bucket = byMarket.get(market) ?? [];
    bucket.push(position);
    byMarket.set(market, bucket);
  }

  return [...byMarket.entries()]
    .map(([market, marketPositions]) => {
      let longNotional = 0;
      let shortNotional = 0;
      let biggestPosition = marketPositions[0];
      let newestOpen = marketPositions[0];
      let strongestPnl: WhalePosition | null = null;
      const whales = new Map<string, TopWhale>();

      for (const position of marketPositions) {
        if (position.side === "long") {
          longNotional += position.notionalUsd;
        } else {
          shortNotional += position.notionalUsd;
        }

        if (position.notionalUsd > biggestPosition.notionalUsd) {
          biggestPosition = position;
        }
        if (position.openedAtMs > newestOpen.openedAtMs) {
          newestOpen = position;
        }
        if (
          position.unrealizedPnlPct != null &&
          (strongestPnl == null ||
            strongestPnl.unrealizedPnlPct == null ||
            position.unrealizedPnlPct > strongestPnl.unrealizedPnlPct)
        ) {
          strongestPnl = position;
        }

        const whaleKey = position.whaleId || position.sourceAccount;
        const current = whales.get(whaleKey) ?? {
          whaleId: position.whaleId,
          displayName: position.displayName,
          sourceAccount: position.sourceAccount,
          source: position.source,
          notionalUsd: 0,
          longNotional: 0,
          shortNotional: 0,
          positionCount: 0,
        };
        current.notionalUsd += position.notionalUsd;
        current.positionCount += 1;
        if (position.side === "long") {
          current.longNotional += position.notionalUsd;
        } else {
          current.shortNotional += position.notionalUsd;
        }
        whales.set(whaleKey, current);
      }

      const totalNotional = longNotional + shortNotional;
      const longPct = totalNotional > 0 ? (longNotional / totalNotional) * 100 : 0;
      const shortPct = totalNotional > 0 ? 100 - longPct : 0;
      const netNotional = longNotional - shortNotional;
      const bias = getMarketBias(longNotional, shortNotional);
      const topWhale = [...whales.values()].sort(
        (a, b) => b.notionalUsd - a.notionalUsd,
      )[0];

      return {
        market,
        positions: marketPositions,
        whaleCount: whales.size,
        totalNotional,
        longNotional,
        shortNotional,
        netNotional,
        longPct,
        shortPct,
        bias,
        topWhale,
        biggestPosition,
        newestOpen,
        strongestPnl,
      };
    })
    .sort(compareMarketHeatRows);
}

function isLiveHeatPosition(position: WhalePosition, nowMs: number): boolean {
  return (
    !position.stale &&
    (nowMs <= 0 || isSourceFresh(position.lastSeenAtMs, undefined, nowMs))
  );
}

function MarketHeatCard({
  row,
  heat,
  now,
}: {
  row: MarketHeatRow;
  heat: MarketHeatDisplay;
  now: number;
}) {
  const biasColor =
    heat.bias === "long" ? GREEN : heat.bias === "short" ? RED : ACCENT;
  const topWhaleSide =
    row.topWhale.longNotional >= row.topWhale.shortNotional ? "long" : "short";

  return (
    <article
      className="overflow-hidden rounded-lg border-2"
      style={{ background: PANEL, borderColor: FAINT }}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[34px] font-black uppercase leading-none">
              {row.market}
            </div>
            <div
              className="mt-1 text-[10px] font-black uppercase tracking-[0.18em]"
              style={{ color: DIM }}
            >
              {row.whaleCount} whales | {row.positions.length} positions
              {" | "}
              {heat.sourceLabel}
            </div>
          </div>
          <div className="text-right">
            <div
              className="rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em]"
              style={{ borderColor: biasColor, color: biasColor }}
            >
              {heat.bias}
            </div>
            <div
              className="mt-2 text-[10px] font-black uppercase tracking-[0.16em]"
              style={{ color: DIM }}
            >
              {formatUsd(heat.totalNotional)}
            </div>
          </div>
        </div>

        <div
          className="mt-4 h-4 overflow-hidden rounded-full border"
          style={{ borderColor: FAINT, background: BG }}
          aria-label={`${row.market} long short split`}
        >
          <div className="flex h-full w-full">
            <div
              className="h-full"
              style={{ width: `${heat.longPct}%`, background: GREEN }}
            />
            <div
              className="h-full"
              style={{ width: `${heat.shortPct}%`, background: RED }}
            />
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <MoneyCell
            icon={ArrowUpRight}
            label={heat.longLabel}
            value={formatUsd(heat.longNotional)}
            share={formatPct(heat.longPct)}
            color={GREEN}
          />
          <MoneyCell
            icon={ArrowDownRight}
            label={heat.shortLabel}
            value={formatUsd(heat.shortNotional)}
            share={formatPct(heat.shortPct)}
            color={RED}
          />
        </div>
      </div>

      <div className="border-t" style={{ borderColor: FAINT }}>
        <LeaderRow
          icon={Crown}
          label="Top Whale"
          value={shortName(row.topWhale.displayName)}
          detail={`${formatUsd(row.topWhale.notionalUsd)} ${topWhaleSide.toUpperCase()}`}
          color={topWhaleSide === "long" ? GREEN : RED}
          avatar={
            <WhaleFingerprintAvatar
              sourceAccount={row.topWhale.sourceAccount}
              label={row.topWhale.displayName}
              size={34}
            />
          }
        />
        <LeaderRow
          icon={Gauge}
          label="Biggest Position"
          value={`${shortName(row.biggestPosition.displayName)} ${row.biggestPosition.side.toUpperCase()}`}
          detail={`${formatUsd(row.biggestPosition.notionalUsd)} ${formatLeverage(row.biggestPosition.leverage)}`}
          color={sideColor(row.biggestPosition.side)}
        />
        <LeaderRow
          icon={Clock3}
          label="Newest Open"
          value={`${shortName(row.newestOpen.displayName)} ${row.newestOpen.side.toUpperCase()}`}
          detail={`${formatWhalePositionAge(row.newestOpen.openedAtMs, now)} AGO`}
          color={sideColor(row.newestOpen.side)}
        />
        <LeaderRow
          icon={Trophy}
          label="Strongest P/L"
          value={
            row.strongestPnl
              ? `${shortName(row.strongestPnl.displayName)} ${row.strongestPnl.side.toUpperCase()}`
              : "No mark"
          }
          detail={
            row.strongestPnl
              ? formatSignedPct(row.strongestPnl.unrealizedPnlPct)
              : "P/L pending"
          }
          color={
            row.strongestPnl && (row.strongestPnl.unrealizedPnlPct ?? 0) >= 0
              ? GREEN
              : RED
          }
        />
      </div>
    </article>
  );
}

function SummaryTile({
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
      className="rounded-lg border p-3"
      style={{ background: PANEL, borderColor: FAINT }}
    >
      <div
        className="text-[10px] font-black uppercase tracking-[0.18em]"
        style={{ color: DIM }}
      >
        {label}
      </div>
      <div
        className="mt-1 text-[22px] font-black uppercase leading-none tabular-nums"
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}

function MoneyCell({
  icon: Icon,
  label,
  value,
  share,
  color,
}: {
  icon: typeof ArrowUpRight;
  label: string;
  value: string;
  share: string;
  color: string;
}) {
  return (
    <div
      className="rounded border px-3 py-2"
      style={{ background: PANEL_2, borderColor: FAINT }}
    >
      <div
        className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.16em]"
        style={{ color: DIM }}
      >
        <Icon size={13} style={{ color }} />
        {label}
      </div>
      <div
        className="mt-1 text-[18px] font-black uppercase leading-none tabular-nums"
        style={{ color }}
      >
        {value}
      </div>
      <div
        className="mt-1 text-[9px] font-black uppercase tracking-[0.16em]"
        style={{ color: DIM }}
      >
        {share}
      </div>
    </div>
  );
}

function LeaderRow({
  icon: Icon,
  label,
  value,
  detail,
  color,
  avatar,
}: {
  icon: typeof Crown;
  label: string;
  value: string;
  detail: string;
  color: string;
  avatar?: React.ReactNode;
}) {
  return (
    <div
      className="grid grid-cols-[34px_1fr_auto] items-center gap-3 border-b px-4 py-3 last:border-b-0"
      style={{ borderColor: FAINT }}
    >
      <div
        className="flex h-8 w-8 items-center justify-center rounded-full"
        style={{ background: PANEL_2, color }}
      >
        {avatar ?? <Icon size={17} strokeWidth={2.8} />}
      </div>
      <div className="min-w-0">
        <div
          className="text-[9px] font-black uppercase tracking-[0.18em]"
          style={{ color: DIM }}
        >
          {label}
        </div>
        <div className="truncate text-[14px] font-black uppercase leading-tight">
          {value}
        </div>
      </div>
      <div
        className="max-w-[120px] text-right text-[12px] font-black uppercase leading-tight tabular-nums"
        style={{ color }}
      >
        {detail}
      </div>
    </div>
  );
}

function EmptyHeat() {
  return (
    <div
      className="flex min-h-[50vh] flex-col items-center justify-center rounded-lg border-2 px-5 py-12 text-center"
      style={{ background: PANEL, borderColor: FAINT }}
    >
      <div className="text-[34px] font-black uppercase leading-none">
        NO HEAT YET
      </div>
      <div
        className="mt-2 max-w-sm text-sm font-semibold"
        style={{ color: DIM, fontFamily: FONT_BODY }}
      >
        Market whale money appears here as soon as the next source refresh lands.
      </div>
    </div>
  );
}

function buildHeatSummary(
  entries: Array<{ row: MarketHeatRow; heat: MarketHeatDisplay }>,
) {
  return entries.reduce(
    (summary, row) => ({
      marketCount: summary.marketCount + 1,
      longNotional: summary.longNotional + row.heat.longNotional,
      shortNotional: summary.shortNotional + row.heat.shortNotional,
      netNotional: summary.netNotional + row.heat.netNotional,
    }),
    {
      marketCount: 0,
      longNotional: 0,
      shortNotional: 0,
      netNotional: 0,
    },
  );
}

function getMarketHeatDisplay(
  row: MarketHeatRow,
  sentiment?: MarketSentiment,
): MarketHeatDisplay {
  const hasPublicSplit =
    sentiment?.longPressureUsd != null &&
    sentiment.shortPressureUsd != null &&
    sentiment.longPct != null &&
    sentiment.shortPct != null;

  if (hasPublicSplit) {
    const longNotional = sentiment.longPressureUsd ?? 0;
    const shortNotional = sentiment.shortPressureUsd ?? 0;
    const totalNotional =
      sentiment.openInterestUsd ?? longNotional + shortNotional;
    return {
      totalNotional,
      longNotional,
      shortNotional,
      netNotional: longNotional - shortNotional,
      longPct: sentiment.longPct ?? 0,
      shortPct: sentiment.shortPct ?? 0,
      bias: sentiment.bias === "unknown" ? row.bias : sentiment.bias,
      sourceLabel: "Public positioning",
      longLabel: "Long Pressure",
      shortLabel: "Short Pressure",
    };
  }

  return {
    totalNotional: row.totalNotional,
    longNotional: row.longNotional,
    shortNotional: row.shortNotional,
    netNotional: row.netNotional,
    longPct: row.longPct,
    shortPct: row.shortPct,
    bias: row.bias,
    sourceLabel: sentiment?.hyperliquid ? "Public OI" : "Tracked whales",
    longLabel: "Long Money",
    shortLabel: "Short Money",
  };
}

function getMarketBias(
  longNotional: number,
  shortNotional: number,
): MarketHeatRow["bias"] {
  const total = longNotional + shortNotional;
  if (total <= 0) return "balanced";
  const skew = Math.abs(longNotional - shortNotional) / total;
  if (skew < 0.12) return "balanced";
  return longNotional > shortNotional ? "long" : "short";
}

function compareMarketHeatRows(a: MarketHeatRow, b: MarketHeatRow): number {
  const aRank = getPinnedMarketRank(a.market);
  const bRank = getPinnedMarketRank(b.market);
  if (aRank !== bRank) return aRank - bRank;
  return b.totalNotional - a.totalNotional;
}

function getPinnedMarketRank(market: string): number {
  return PINNED_MARKET_RANK.get(market) ?? Number.MAX_SAFE_INTEGER;
}

function normalizeMarket(market: string): string {
  return market.trim().toUpperCase() || "UNKNOWN";
}

function sideColor(side: WhalePosition["side"]) {
  return side === "long" ? GREEN : RED;
}

function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000) {
    return `${sign}$${USD_COMPACT.format(abs)}`;
  }
  return `${sign}$${USD_WHOLE.format(abs)}`;
}

function formatSignedUsd(value: number): string {
  if (value === 0) return "$0";
  return `${value > 0 ? "+" : "-"}${formatUsd(Math.abs(value))}`;
}

function formatPct(value: number): string {
  return `${Math.round(value)}%`;
}

function formatSignedPct(value: number | null): string {
  if (value == null) return "P/L pending";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatLeverage(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return `${value.toFixed(value >= 10 ? 0 : 1)}X`;
}

function shortName(name: string): string {
  if (name.length <= 18) return name;
  return `${name.slice(0, 15)}...`;
}

function useVisiblePoll(fn: () => void | Promise<void>, ms: number) {
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      void fn();
    };
    const id = setInterval(tick, ms);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [fn, ms]);
}

const USD_COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const USD_WHOLE = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
