// Pure helpers for the unified /feed (whales + arena bots, Invo-style
// stacked cards). Everything here is renderer-free so it can be unit tested:
// the sort/filter ranking, per-entity sort values, bot position P&L math,
// freshness formatting, and the stale-roster poll guard salvaged from the
// old WhaleRoster.

import type { ArenaBot, ArenaPosition } from "@/lib/arena/decode";
import type { WhaleTraderSignal } from "@/lib/types";

// ─────────────────────────── filters + sorts ──────────────────────────────

export type FeedEntityFilter = "all" | "whales" | "bots";
export type FeedSortKey = "pnl1d" | "pnl7d" | "pnl30d" | "equity";

export const FEED_ENTITY_OPTIONS: { key: FeedEntityFilter; label: string }[] =
  [
    { key: "all", label: "All" },
    { key: "whales", label: "Whales" },
    { key: "bots", label: "Bots" },
  ];

// Hot/heat is gone on purpose — the feed ranks on real P&L windows only.
export const FEED_SORT_OPTIONS: { key: FeedSortKey; label: string }[] = [
  { key: "pnl1d", label: "1D" },
  { key: "pnl7d", label: "7D" },
  { key: "pnl30d", label: "30D" },
  { key: "equity", label: "Equity" },
];

export type FeedEntry =
  | { kind: "whale"; whale: WhaleTraderSignal }
  | { kind: "bot"; name: string; bot: ArenaBot | null };

type WhaleStats = WhaleTraderSignal["payload"]["stats"];

export function whaleSortValue(
  whale: WhaleTraderSignal,
  sortKey: FeedSortKey,
): number {
  const stats = whale.payload.stats;
  switch (sortKey) {
    case "pnl1d":
      return stats.pnl1dUsdc;
    case "pnl7d":
      return stats.pnl7dUsdc;
    case "pnl30d":
      return stats.pnl30dUsdc;
    case "equity":
      return stats.equityUsdc;
  }
}

/** Equity the same way the arena page counts it: cash + open stake. */
export function botEquityUsd(bot: ArenaBot): number {
  const openStake = bot.positions
    .filter((p) => p.active)
    .reduce((sum, p) => sum + p.stakeUsd, 0);
  return bot.balanceUsd + openStake;
}

/** Bots have no windowed P&L on chain — gross P&L stands in for every
 *  window. Unloaded bots sink to the bottom instead of faking zeros. */
export function botSortValue(
  bot: ArenaBot | null,
  sortKey: FeedSortKey,
): number {
  if (!bot) return Number.NEGATIVE_INFINITY;
  if (sortKey === "equity") return botEquityUsd(bot);
  return bot.grossPnlUsd;
}

export function feedSortValue(entry: FeedEntry, sortKey: FeedSortKey): number {
  return entry.kind === "whale"
    ? whaleSortValue(entry.whale, sortKey)
    : botSortValue(entry.bot, sortKey);
}

/** Filter to the selected entity kind, then rank by the sort value desc.
 *  Stable for ties (Array#sort), so equal-valued entries keep input order. */
export function rankFeedEntries(
  entries: FeedEntry[],
  filter: FeedEntityFilter,
  sortKey: FeedSortKey,
): FeedEntry[] {
  const filtered =
    filter === "all"
      ? entries
      : entries.filter((entry) =>
          filter === "whales" ? entry.kind === "whale" : entry.kind === "bot",
        );
  return [...filtered].sort(
    (a, b) => feedSortValue(b, sortKey) - feedSortValue(a, sortKey),
  );
}

// ───────────────────────────── header P&L ─────────────────────────────────

/** What the card's right-side P&L block shows for a whale. Whale stats are
 *  USD (no honest percent basis exists), so the value is signed USD for the
 *  active sort window — Equity sort falls back to the 1D window. Whales on
 *  live-position estimates have no real windowed stats; show the live
 *  estimate, labeled as such, instead of confident zeros. */
export function whaleHeaderPnl(
  stats: WhaleStats,
  sortKey: FeedSortKey,
): { label: string; usd: number; estimated: boolean } {
  if (stats.statsSource === "live_positions") {
    return { label: "Live P&L", usd: stats.pnlAllTimeUsdc, estimated: true };
  }
  switch (sortKey) {
    case "pnl7d":
      return { label: "P&L 7D", usd: stats.pnl7dUsdc, estimated: false };
    case "pnl30d":
      return { label: "P&L 30D", usd: stats.pnl30dUsdc, estimated: false };
    case "pnl1d":
    case "equity":
      return { label: "P&L 1D", usd: stats.pnl1dUsdc, estimated: false };
  }
}

/** Arena bots all start from the same on-chain paper bankroll. */
export const ARENA_START_BALANCE_USD = 1_000;

/** Lifetime P&L percent against the fixed start balance. */
export function botPnlPct(bot: ArenaBot): number {
  return (bot.grossPnlUsd / ARENA_START_BALANCE_USD) * 100;
}

// ─────────────────────────── bot position math ────────────────────────────

/** Single SOL market on devnet today; fail readable for future ids. */
export const ARENA_MARKET_TICKERS: Record<number, string> = { 0: "SOL" };

export function arenaMarketTicker(marketId: number): string {
  return ARENA_MARKET_TICKERS[marketId] ?? `MKT${marketId}`;
}

/** Leveraged position P&L percent off the live oracle mark. Null when the
 *  mark or entry can't support honest math (no mark yet, zero entry). */
export function botPositionPnlPct(
  pos: ArenaPosition,
  markPrice: number | null,
): number | null {
  if (
    markPrice === null ||
    !Number.isFinite(markPrice) ||
    markPrice <= 0 ||
    !Number.isFinite(pos.entryPrice) ||
    pos.entryPrice <= 0
  ) {
    return null;
  }
  const direction = pos.side === "long" ? 1 : -1;
  return ((markPrice - pos.entryPrice) / pos.entryPrice) * direction *
    pos.leverage * 100;
}

/** The bot's primary open position for the card: the freshest active slot
 *  (the one the "New Position" footer is about). */
export function primaryBotPosition(bot: ArenaBot): ArenaPosition | null {
  const active = bot.positions.filter((p) => p.active);
  if (active.length === 0) return null;
  return active.reduce((newest, p) =>
    p.openedTsMs > newest.openedTsMs ? p : newest,
  );
}

// ───────────────────────────── formatting ─────────────────────────────────

/** Header freshness: "now" under a minute, then m / h / d buckets. */
export function formatFeedAge(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "—";
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Signed percent with two decimals: +2.37% / -0.40%. */
export function formatSignedPct(pct: number): string {
  const sign = pct >= 0 ? "+" : "-";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

/** Compact signed USD for the header P&L block: +$12.4K / -$1.2M. */
export function formatCompactSignedUsd(value: number): string {
  const sign = value >= 0 ? "+" : "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${trimCompact(abs / 1_000_000, 1)}M`;
  if (abs >= 1_000) {
    const digits = abs >= 100_000 ? 0 : 1;
    return `${sign}$${trimCompact(abs / 1_000, digits)}K`;
  }
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function trimCompact(value: number, maximumFractionDigits: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  });
}

export const SOURCE_CHIP_LABELS: Record<string, string> = {
  pacifica: "PAC",
  hyperliquid: "HL",
  ostium: "OST",
};

export function sourceChipLabel(source: string): string {
  return SOURCE_CHIP_LABELS[source] ?? source.slice(0, 3).toUpperCase();
}

/** Positions younger than this get the "New position" footer treatment. */
export const FRESH_POSITION_MS = 15 * 60_000;

// ─────────────────────────── poll refresh guard ───────────────────────────

/** Salvaged from the old WhaleRoster: never replace a roster that has open
 *  positions with an all-stale, zero-position refresh (a flaky upstream
 *  poll), and never blank a good roster with an empty response. */
export function shouldUseRosterRefresh(
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

/** Chronological close series from the on-chain market candle ring (oldest →
 *  newest, in-progress head bucket excluded, never-written slots skipped).
 *  Feeds the bot-card sparkline with real ER data. */
export function ringClosesChronological(market: {
  ring: Array<{ close: number; startTs?: number; startTsMs?: number; updates: number }>;
  head: number;
}): number[] {
  const n = market.ring.length;
  if (n === 0) return [];
  const closes: number[] = [];
  // Walk forward from the oldest slot (head+1) up to but excluding head.
  for (let i = 1; i < n; i++) {
    const b = market.ring[(market.head + i) % n];
    const written = (b.startTsMs ?? b.startTs ?? 0) !== 0;
    if (written && Number.isFinite(b.close) && b.close > 0) closes.push(b.close);
  }
  return closes.length >= 2 ? closes : [];
}
