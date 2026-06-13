// lib/arena/llm/brief.ts
//
// Builds the market brief the oracle bots reason over. Two rules from the
// research bake in here:
//   1. ARENA FAIRNESS — the market block is built ONCE and is byte-identical for
//      every bot; only the per-bot system/persona block and the bot's own book
//      differ. "Model is the only variable."
//   2. INJECTION HYGIENE — numeric positioning data (OI/long-short/funding) is
//      safe; the news/social sentiment summary is sanitized (no URLs/@handles)
//      before it ever enters a prompt.
//
// The model gets DERIVED signals (price + indicators + funding + OI/long-short +
// sentiment + its own book + an explicit timestamp), never raw OHLCV.

import type { Candle } from "../../data/candles";
import type { MarketSentiment } from "../../data/market-sentiment";
import { atr, macd, realizedVol, rsi } from "../../data/indicators";
import type { ArenaLlmBot } from "../decode";
import { ARENA_ASSETS, type ArenaAsset } from "./schema";

export interface SentimentBrief {
  score: number; // -1..1
  summary: string; // sanitized
  topics: string[];
}

export interface MarketLine {
  asset: ArenaAsset;
  price: number | null;
  change1hPct: number | null;
  rsi14: number | null;
  macdHist: number | null;
  atr14: number | null;
  volPct: number | null;
  fundingRatePct: number | null;
  openInterestUsd: number | null;
  longPct: number | null;
  shortPct: number | null;
  takerBuySellRatio: number | null;
  bias: string | null;
}

export interface SharedBrief {
  timestampIso: string;
  markets: MarketLine[];
  sentiment: SentimentBrief | null;
}

export interface BriefSources {
  nowIso: () => string;
  candles: (asset: ArenaAsset) => Promise<Candle[]>; // chronological, newest last
  sentimentSnapshot: () => Promise<Record<string, MarketSentiment>>;
  newsSentiment?: () => Promise<SentimentBrief | null>;
}

/** Strip URLs and @handles so untrusted social text can't carry instructions. */
export function sanitizeSentimentText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/@[A-Za-z0-9_]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 200);
}

function pct(n: number | null | undefined): number | null {
  return n == null ? null : Math.round(n * 10_000) / 10_000;
}

export async function buildSharedBrief(src: BriefSources): Promise<SharedBrief> {
  const snap = await src.sentimentSnapshot().catch(() => ({}) as Record<string, MarketSentiment>);

  const markets: MarketLine[] = [];
  for (const asset of ARENA_ASSETS) {
    const candles = await src.candles(asset).catch(() => [] as Candle[]);
    const closes = candles.map((c) => c.close);
    const last = closes[closes.length - 1] ?? null;
    const hourAgo = closes.length >= 2 ? closes[Math.max(0, closes.length - 2)] : null;
    const s = snap[asset];
    const m = macd(closes);
    markets.push({
      asset,
      price: last,
      change1hPct: last != null && hourAgo ? pct(((last - hourAgo) / hourAgo) * 100) : null,
      rsi14: rsi(closes, 14),
      macdHist: m ? m.hist : null,
      atr14: atr(candles, 14),
      volPct: realizedVol(closes) != null ? pct(realizedVol(closes)! * 100) : null,
      fundingRatePct: pct(s?.fundingRate != null ? s.fundingRate * 100 : null),
      openInterestUsd: s?.openInterestUsd ?? null,
      longPct: s?.longPct ?? null,
      shortPct: s?.shortPct ?? null,
      takerBuySellRatio: s?.binance?.takerBuySellRatio ?? null,
      bias: s?.bias ?? null,
    });
  }

  let sentiment: SentimentBrief | null = null;
  if (src.newsSentiment) {
    const raw = await src.newsSentiment().catch(() => null);
    if (raw) sentiment = { ...raw, summary: sanitizeSentimentText(raw.summary) };
  }

  return { timestampIso: src.nowIso(), markets, sentiment };
}

const f = (n: number | null, digits = 2, suffix = "") =>
  n == null ? "n/a" : `${n.toFixed(digits)}${suffix}`;
const money = (n: number | null) =>
  n == null ? "n/a" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${(n / 1e6).toFixed(1)}M`;

/** The market block — IDENTICAL for every bot (arena fairness). */
export function renderMarketBlock(brief: SharedBrief): string {
  const lines = [`Market snapshot @ ${brief.timestampIso} (all data time-stamped at this instant):`];
  for (const m of brief.markets) {
    lines.push(
      `${m.asset}: $${f(m.price)}  1h ${f(m.change1hPct, 2, "%")}  RSI14 ${f(m.rsi14, 0)}  ` +
        `MACDhist ${f(m.macdHist, 3)}  ATR14 ${f(m.atr14)}  vol ${f(m.volPct, 2, "%")}  ` +
        `funding ${f(m.fundingRatePct, 4, "%")}  OI ${money(m.openInterestUsd)}  ` +
        `long/short ${f(m.longPct, 0, "%")}/${f(m.shortPct, 0, "%")} (${m.bias ?? "n/a"})  ` +
        `taker b/s ${f(m.takerBuySellRatio)}`,
    );
  }
  if (brief.sentiment) {
    lines.push(
      `News/social sentiment: score ${brief.sentiment.score.toFixed(2)} — ${brief.sentiment.summary}` +
        (brief.sentiment.topics.length ? ` [${brief.sentiment.topics.join(", ")}]` : ""),
    );
  }
  return lines.join("\n");
}

/** The bot's own book — per-bot (differs by bot, that's expected). */
export function renderBookBlock(bot: ArenaLlmBot): string {
  const open = bot.positions.filter((p) => p.active);
  const openStake = open.reduce((a, p) => a + p.stakeUsd, 0);
  const equity = bot.balanceUsd + openStake;
  const posLines = open.length
    ? open
        .map(
          (p) =>
            `  ${p.side} ${p.marketId === 0 ? "SOL" : `mkt${p.marketId}`} ${p.leverage}x ` +
            `entry $${p.entryPrice.toFixed(2)} stake $${p.stakeUsd.toFixed(0)} stop $${p.stopPrice.toFixed(2)}`,
        )
        .join("\n")
    : "  (flat — no open positions)";
  return [
    `Your book: equity ~$${equity.toFixed(0)} (free $${bot.balanceUsd.toFixed(0)}), ` +
      `peak $${bot.equityHighUsd.toFixed(0)}, fees paid $${bot.feesUsd.toFixed(2)}, ` +
      `funding paid $${bot.fundingPaidUsd.toFixed(2)}, trades today ${bot.tradesToday}` +
      (bot.halted ? " — HALTED (daily loss limit hit; opens are blocked)" : ""),
    "Open positions:",
    posLines,
  ].join("\n");
}

/** Full prompt: per-bot system/persona block + identical market block + own book. */
export function renderPromptFor(args: {
  systemBlock: string;
  bot: ArenaLlmBot;
  brief: SharedBrief;
}): string {
  return [
    args.systemBlock.trim(),
    "",
    renderMarketBlock(args.brief),
    "",
    renderBookBlock(args.bot),
    "",
    "Decide: open / close / hold. Return the structured decision. Most ticks, doing nothing is correct — only trade a setup you can justify in one sentence.",
  ].join("\n");
}
