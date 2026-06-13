"use client";

// One arena bot's live stat card. Pure presentation over a decoded ArenaBot
// (null = skeleton placeholder, same footprint — zero layout shift when the
// ER seed lands). Visual recipe mirrors the app's card aesthetic
// (ShareCard/WhaleCard: rounded-3xl, white/10 hairline, soft white gradient)
// on the v2 tokens.

import type { ReactNode } from "react";
import type { ArenaBot, ArenaPosition } from "@/lib/arena/decode";
import { ARENA_PERSONAS } from "@/lib/arena/personas";
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
  onOpen,
  tailCta,
}: {
  name: string;
  bot: ArenaBot | null;
  now: number;
  onOpen?: () => void;
  /** Optional copy CTA rendered under the positions block — the /feed grid
   *  passes the Tail button; /arena keeps rendering without it. */
  tailCta?: ReactNode;
}) {
  const persona = ARENA_PERSONAS[name];
  const display = persona?.display ?? name;
  const openPositions = bot?.positions.filter((p) => p.active) ?? [];
  const openStake = openPositions.reduce((sum, p) => sum + p.stakeUsd, 0);
  const equity = bot ? bot.balanceUsd + openStake : null;
  const pnlColor =
    bot && bot.grossPnlUsd !== 0 ? (bot.grossPnlUsd > 0 ? GREEN : RED) : DIM;

  return (
    <div
      className={`rounded-3xl p-4 text-left ${onOpen ? "cursor-pointer transition-colors" : ""}`}
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
              boxShadow: `0 0 0 2px ${AI}`,
              background: AI_TINT,
            }}
            aria-hidden
          >
            {persona?.emoji ?? "🤖"}
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
            equity (incl. open stake)
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
            gross p/l
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
              {fmtSignedUsd(bot.grossPnlUsd)}
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

      {/* open positions */}
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
            />
          ))
        )}
      </div>

      {/* Stop propagation so a CTA tap never doubles as the card's onOpen. */}
      {tailCta ? (
        <div
          className="mt-3"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {tailCta}
        </div>
      ) : null}
    </div>
  );
}

function PositionRow({ pos, now }: { pos: ArenaPosition; now: number }) {
  const long = pos.side === "long";
  const sideColor = long ? GREEN : RED;
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
      <span style={{ color: DIM }}>
        in {fmtArenaPrice(pos.entryPrice)} · liq {fmtArenaPrice(pos.liqPrice)}
      </span>
      <span style={{ color: DIM }}>{fmtAge(pos.openedTsMs, now)}</span>
    </div>
  );
}
