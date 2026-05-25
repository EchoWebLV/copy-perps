import type { WhalePositionSignal } from "@/lib/types";

const FRESH_OPEN_MS = 15 * 60_000;
const BIG_POSITION_USD = 500_000;
const DEEP_PROFIT_PCT = 25;
const PAIN_PCT = -10;
const MAX_ITEMS = 80;

export type PulseItemKind =
  | "fresh_open"
  | "big_position"
  | "deep_profit"
  | "pain_trade"
  | "entry_gap";

export interface PulseItem {
  id: string;
  kind: PulseItemKind;
  score: number;
  eyebrow: string;
  headline: string;
  context: string;
  reactionSeed: number;
  canTail: boolean;
  position: WhalePositionSignal["payload"];
}

type PositionPayload = WhalePositionSignal["payload"];

export function buildPulseItems(
  positions: WhalePositionSignal[],
  nowMs: number,
): PulseItem[] {
  return positions
    .flatMap((signal) => itemsForPosition(signal.payload, nowMs))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ITEMS);
}

function itemsForPosition(position: PositionPayload, nowMs: number): PulseItem[] {
  const items: PulseItem[] = [];
  const openedAgoMs = Math.max(0, nowMs - position.openedAtMs);
  const pnl = position.unrealizedPnlPct;

  if (openedAgoMs <= FRESH_OPEN_MS) {
    items.push(
      makeItem({
        position,
        kind: "fresh_open",
        score: baseScore(position, nowMs) + 160,
        eyebrow: "Fresh open",
        headline:
          performanceHeadline(position) ??
          `${position.displayName} opened ${position.market} ${position.side} ${position.leverage}x`,
        context: `${formatUsd(position.notionalUsd)} live on ${position.source}. This is new enough to watch before the tape moves too far.`,
      }),
    );
  }

  if (position.notionalUsd >= BIG_POSITION_USD) {
    items.push(
      makeItem({
        position,
        kind: "big_position",
        score: baseScore(position, nowMs) + 120,
        eyebrow: "Big size",
        headline:
          performanceHeadline(position) ??
          `${position.displayName} is carrying a ${formatUsd(position.notionalUsd)} ${position.market} ${position.side}`,
        context: `Large notional, ${position.leverage}x leverage, ${sourcePnlText(pnl)} on the source position.`,
      }),
    );
  }

  if (pnl !== null && pnl >= DEEP_PROFIT_PCT) {
    items.push(
      makeItem({
        position,
        kind: "deep_profit",
        score: baseScore(position, nowMs) + 100 + Math.min(80, pnl),
        eyebrow: "Deep in profit",
        headline:
          performanceHeadline(position) ??
          `${position.market} ${position.side} is already up ${pnl.toFixed(1)}%`,
        context: "Tailing now means entering after part of the whale's move has already happened.",
      }),
    );
  }

  if (pnl !== null && pnl <= PAIN_PCT) {
    items.push(
      makeItem({
        position,
        kind: "pain_trade",
        score: baseScore(position, nowMs) + 90 + Math.min(80, Math.abs(pnl)),
        eyebrow: "Pain trade",
        headline:
          performanceHeadline(position) ??
          `${position.displayName} is still holding a losing ${position.market} ${position.side}`,
        context: `${sourcePnlText(pnl)}. The whale has not exited, but leverage makes timing fragile.`,
      }),
    );
  }

  if (position.analysis?.entryGapWarning) {
    items.push(
      makeItem({
        position,
        kind: "entry_gap",
        score: baseScore(position, nowMs) + 85 + position.leverage,
        eyebrow: "Entry gap",
        headline:
          performanceHeadline(position) ??
          `Late entry risk on ${position.market} ${position.side}`,
        context: shorten(position.analysis.entryGapWarning, 132),
      }),
    );
  }

  return items;
}

function makeItem(args: {
  position: PositionPayload;
  kind: PulseItemKind;
  score: number;
  eyebrow: string;
  headline: string;
  context: string;
}): PulseItem {
  return {
    id: `${args.position.positionId}:${args.kind}`,
    kind: args.kind,
    score: Math.round(args.score),
    eyebrow: args.eyebrow,
    headline: args.headline,
    context: args.context,
    reactionSeed: stableSeed(`${args.position.positionId}:${args.kind}`),
    canTail: !args.position.stale && args.position.copyableOnPacifica !== false,
    position: args.position,
  };
}

function baseScore(position: PositionPayload, nowMs: number): number {
  const ageMinutes = Math.max(0, (nowMs - position.openedAtMs) / 60_000);
  const recency = Math.max(0, 60 - ageMinutes);
  const size = Math.min(140, Math.log10(Math.max(1, position.notionalUsd)) * 18);
  const leverage = Math.min(60, position.leverage * 1.5);
  const copyable = !position.stale && position.copyableOnPacifica !== false ? 30 : -80;
  return recency + size + leverage + copyable;
}

function stableSeed(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function sourcePnlText(pnl: number | null): string {
  if (pnl === null) return "P/L unavailable";
  return `${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}% source P/L`;
}

function performanceHeadline(position: PositionPayload): string | null {
  const pnl = position.unrealizedPnlPct;
  if (pnl === null) return null;
  const direction = pnl >= 0 ? "up" : "down";
  return `${position.market} ${position.side} is already ${direction} ${Math.abs(
    pnl,
  ).toFixed(1)}%`;
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

function shorten(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
