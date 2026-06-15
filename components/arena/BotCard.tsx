"use client";

// One arena bot's live stat card. Pure presentation over a decoded ArenaBot
// (null = skeleton placeholder, same footprint — zero layout shift when the
// ER seed lands). Visual recipe mirrors the app's card aesthetic
// (ShareCard/WhaleCard: rounded-3xl, white/10 hairline, soft white gradient)
// on the v2 tokens.

import type { ReactNode } from "react";
import type { ArenaBot, ArenaMarketState, ArenaPosition } from "@/lib/arena/decode";
import { ARENA_PERSONAS } from "@/lib/arena/personas";
import { isStale } from "@/lib/arena/use-arena-live";
import {
  botPositionPnlPct,
  botEquityUsd,
  botTotalPnlUsd,
} from "@/components/feed/unified-feed-model";
import {
  SentimentRow,
  EMPTY_SENTIMENT,
  type TraderSentiment,
  type WhaleVote,
} from "@/components/feed/DesktopWhaleCard";
import { AI, AI_BORDER, AI_DIM, AiBotBadge, DIM, FAINT, GREEN, RED, AI_TINT } from "@/components/v2/ui";

/** $ price for the header/positions: 2dp ≥ $1, 4dp below (memecoin-safe). */
export function fmtArenaPrice(price: number): string {
  if (!Number.isFinite(price)) return "—";
  const dp = Math.abs(price) >= 1 ? 2 : 4;
  return `$${price.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`;
}

function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtSignedUsd(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${fmtUsd(Math.abs(v))}`;
}

function fmtAge(openedTsMs: number, now: number): string {
  if (now <= 0 || openedTsMs <= 0) return "—";
  const s = Math.max(0, Math.floor((now - openedTsMs) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

export function BotCard({
  name,
  bot,
  now,
  market,
  sentiment,
  onReact,
  onOpen,
  tailCta,
}: {
  name: string;
  bot: ArenaBot | null;
  now: number;
  /** Live oracle market — threads the mark price in so positions show live
   *  PnL. Optional: callers without it (legacy) just render entry-only rows. */
  market?: ArenaMarketState | null;
  /** Community Bullish/Bearish vote — same widget + backend as the whale
   *  cards, keyed per bot. Omit to hide the row. */
  sentiment?: TraderSentiment | null;
  onReact?: (reaction: WhaleVote) => void;
  onOpen?: () => void;
  /** Optional copy CTA rendered under the positions block — the /feed grid
   *  passes the Tail button; /arena keeps rendering without it. */
  tailCta?: ReactNode;
}) {
  const persona = ARENA_PERSONAS[name];
  const display = persona?.display ?? name;
  const openPositions = bot?.positions.filter((p) => p.active) ?? [];
  // Live mark for PnL, gated on freshness so stale numbers render dimmed.
  // Single-market (SOL-only) arena: the hook streams exactly one market feed,
  // so every open position marks against it. A position's stored marketId byte
  // can differ from the live market PDA's id across clusters (devnet's live
  // market is id 1 while positions carry id 0) — same SOL price either way.
  const mkt = market ?? null;
  const marketStale = mkt !== null && now > 0 && isStale(mkt.lastPublishTsMs, now);
  const livePrice = mkt?.lastPrice ?? null;
  // Mark-to-market: equity AND the headline P/L both fold in unrealized P&L on
  // the open position(s), so the card shows the bot's true live standing — not
  // just realized trades. (Stale/absent mark → unrealized 0 → balance+margin.)
  const equity = bot ? botEquityUsd(bot, livePrice) : null;
  const totalPnl = bot ? botTotalPnlUsd(bot, livePrice) : 0;
  const pnlColor = bot && totalPnl !== 0 ? (totalPnl > 0 ? GREEN : RED) : DIM;

  return (
    <div
      className={`flex flex-col rounded-3xl p-4 text-left ${onOpen ? "cursor-pointer transition-colors" : ""}`}
      style={{
        background: AI_DIM,
        border: `1px solid ${AI_BORDER}`,
      }}
      onClick={onOpen}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={
        onOpen
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onOpen();
            }
          : undefined
      }>
      {/* header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex shrink-0 items-center justify-center rounded-xl text-2xl leading-none"
            style={{
              width: 40,
              height: 40,
              boxShadow: persona?.image ? "none" : `0 0 0 2px ${AI}`,
              background: persona?.image ? "transparent" : AI_TINT,
            }}
            aria-hidden
          >
            {persona?.image ? (
              <img src={persona.image} alt="" className="h-full w-full rounded-xl object-cover" />
            ) : (
              persona?.emoji ?? "🤖"
            )}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-black uppercase tracking-wide">
              {display}
            </div>
            <div
              className="truncate text-[10px] font-bold uppercase tracking-widest"
              style={{ color: DIM }}
            >
              {persona?.blurb ?? name}
            </div>
          </div>
        </div>
        <AiBotBadge />
      </div>

      {/* equity + pnl */}
      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div
            className="text-[9px] font-black uppercase tracking-[0.2em]"
            style={{ color: DIM }}
          >
            equity (live)
          </div>
          {equity === null ? (
            <span
              className="skeleton-block mt-1 inline-block h-7 w-28 rounded-md"
              aria-hidden
            />
          ) : (
            <div className="text-[26px] font-black leading-none tabular-nums">
              {fmtUsd(equity)}
            </div>
          )}
        </div>
        <div className="text-right">
          <div
            className="text-[9px] font-black uppercase tracking-[0.2em]"
            style={{ color: DIM }}
          >
            total p/l
          </div>
          {bot === null ? (
            <span
              className="skeleton-block mt-1 inline-block h-5 w-20 rounded-md"
              aria-hidden
            />
          ) : (
            <div
              className="text-[17px] font-black leading-tight tabular-nums"
              style={{ color: pnlColor }}
            >
              {fmtSignedUsd(totalPnl)}
            </div>
          )}
        </div>
      </div>

      {/* stats row */}
      <div
        className="mt-3 flex items-center gap-4 border-t pt-3 text-[10px] font-bold uppercase tracking-widest tabular-nums"
        style={{ borderColor: FAINT, color: DIM }}
      >
        <span>
          win rate{" "}
          <span style={{ color: bot && bot.trades > 0 ? undefined : DIM }}>
            {bot && bot.trades > 0
              ? `${Math.round((bot.wins / bot.trades) * 100)}%`
              : "—"}
          </span>
        </span>
        <span>trades {bot ? bot.trades : "—"}</span>
        <span>fees {bot ? fmtUsd(bot.feesUsd) : "—"}</span>
      </div>

      {/* community bull/bear vote — same widget as the whale cards. Stop
          propagation so a vote tap never doubles as the card's onOpen. */}
      {onReact && (
        <div
          className="mt-2"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <SentimentRow
            sentiment={sentiment ?? EMPTY_SENTIMENT}
            onReact={onReact}
          />
        </div>
      )}

      {/* open positions (live) */}
      <div className="mt-3 flex flex-col gap-1.5">
        {bot === null ? (
          <span
            className="skeleton-block inline-block h-9 w-full rounded-xl"
            aria-hidden
          />
        ) : openPositions.length === 0 ? (
          <div
            className="rounded-xl border border-dashed px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest"
            style={{ borderColor: FAINT, color: DIM }}
          >
            flat — waiting for a breakout
          </div>
        ) : (
          openPositions.map((pos) => (
            <PositionRow
              key={`${pos.marketId}-${pos.side}-${pos.openedTsMs}`}
              pos={pos}
              now={now}
              markPrice={livePrice}
              stale={marketStale}
            />
          ))
        )}
      </div>

      {/* Pinned to the card bottom (mt-auto) so the CTA row lines up with the
          whale cards in the stretched grid. Stop propagation so a CTA tap
          never doubles as the card's onOpen. */}
      {tailCta ? (
        <div
          className="mt-auto pt-3"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {tailCta}
        </div>
      ) : null}
    </div>
  );
}

/** Signed percent, e.g. +3.4% / −1.2% / 0.0% (proper minus glyph). */
function fmtSignedPct(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(1)}%`;
}

function PositionRow({
  pos,
  now,
  markPrice,
  stale,
}: {
  pos: ArenaPosition;
  now: number;
  markPrice: number | null;
  stale: boolean;
}) {
  const long = pos.side === "long";
  const sideColor = long ? GREEN : RED;
  const pnlPct = botPositionPnlPct(pos, markPrice);
  const pnlColor =
    pnlPct === null ? DIM : pnlPct > 0 ? GREEN : pnlPct < 0 ? RED : DIM;
  // When the oracle mark is stale, keep showing the last numbers but dim them
  // so we never present a frozen mark as fresh.
  const liveStyle = stale ? { opacity: 0.45 } : undefined;
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[11px] font-bold tabular-nums"
      style={{ borderColor: FAINT }}
    >
      <span
        className="font-black uppercase tracking-widest"
        style={{ color: sideColor }}
      >
        {long ? "long" : "short"} ×{pos.leverage}
      </span>
      <span style={{ color: pnlColor, ...liveStyle }}>
        {pnlPct === null ? "—" : fmtSignedPct(pnlPct)}
      </span>
      <span style={{ color: DIM, ...liveStyle }}>
        {markPrice !== null ? (
          <>
            {fmtArenaPrice(pos.entryPrice)} →{" "}
            <span key={markPrice} className="mark-flash">
              {fmtArenaPrice(markPrice)}
            </span>
          </>
        ) : (
          `in ${fmtArenaPrice(pos.entryPrice)}`
        )}{" "}
        · {fmtAge(pos.openedTsMs, now)}
      </span>
    </div>
  );
}
