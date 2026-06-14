"use client";

// Bot profile overlay: stats, open positions, and the on-chain decision tape
// (every entry decoded straight from the bot's ER account — the unfakeable
// record). Opened from a BotCard tap; plain fixed-overlay sheet matching the
// app's panel aesthetic (no portal dependency — same approach as the app's
// lightweight overlays).

import { useEffect } from "react";
import type { ArenaBot, ArenaMarketState } from "@/lib/arena/decode";
import { arenaAction, tapeNewestFirst } from "@/lib/arena/decode";
import { ARENA_PERSONAS, botPda } from "@/lib/arena/personas";
import { isStale, parseArenaEnv } from "@/lib/arena/use-arena-live";
import { botPositionPnlPct } from "@/components/feed/unified-feed-model";
import {
  SentimentRow,
  EMPTY_SENTIMENT,
  type TraderSentiment,
  type WhaleVote,
} from "@/components/feed/DesktopWhaleCard";
import { isDevnetEndpoint, solscanAccountUrl } from "@/lib/arena/solscan";
import { AI, AiBotBadge, BG, DIM, FAINT, FG, GREEN, RED, Headline, AI_TINT } from "@/components/v2/ui";
import { fmtArenaPrice } from "./BotCard";

const TOKEN_COLORS = { GREEN, RED, DIM } as const;

function fmtUsd(v: number): string {
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtWhen(tsMs: number, now: number): string {
  if (now <= 0 || tsMs <= 0) return "—";
  const s = Math.max(0, Math.floor((now - tsMs) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function BotProfile({
  name,
  bot,
  now,
  market,
  sentiment,
  onReact,
  onClose,
}: {
  name: string;
  bot: ArenaBot | null;
  now: number;
  market?: ArenaMarketState | null;
  sentiment?: TraderSentiment | null;
  onReact?: (reaction: WhaleVote) => void;
  onClose: () => void;
}) {
  const persona = ARENA_PERSONAS[name];
  const env = parseArenaEnv();
  const pda = env ? botPda(name, env.programId).toBase58() : null;
  const tape = bot ? tapeNewestFirst(bot) : [];
  const openPositions = bot?.positions.filter((p) => p.active) ?? [];
  const equity =
    bot === null
      ? null
      : bot.balanceUsd + openPositions.reduce((s, p) => s + p.stakeUsd, 0);
  // Single-market SOL arena — every position marks against the one live feed
  // (see BotCard for the marketId-byte caveat across clusters).
  const mkt = market ?? null;
  const marketStale = mkt !== null && now > 0 && isStale(mkt.lastPublishTsMs, now);
  const livePrice = mkt?.lastPrice ?? null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm lg:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${persona?.display ?? name} profile`}
    >
      <div
        className="no-scrollbar max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-white/10 p-5 lg:rounded-3xl"
        style={{ background: BG, color: FG }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="flex shrink-0 items-center justify-center rounded-xl text-3xl leading-none"
              style={{
                width: 48,
                height: 48,
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
            <div>
              <div className="flex items-center gap-2">
                <Headline size={20}>{persona?.display ?? name}</Headline>
                <AiBotBadge />
              </div>
              <div
                className="mt-0.5 text-[10px] font-bold uppercase tracking-widest"
                style={{ color: DIM }}
              >
                {persona?.blurb ?? name}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-widest"
            style={{ borderColor: FAINT, color: DIM }}
          >
            close
          </button>
        </div>

        {/* stats */}
        <div
          className="mt-4 grid grid-cols-3 gap-3 rounded-2xl border p-3 text-center tabular-nums"
          style={{ borderColor: FAINT }}
        >
          <Stat label="equity" value={equity === null ? "—" : fmtUsd(equity)} />
          <Stat
            label="gross p/l"
            value={bot ? fmtUsd(bot.grossPnlUsd) : "—"}
            color={
              bot && bot.grossPnlUsd !== 0
                ? bot.grossPnlUsd > 0
                  ? GREEN
                  : RED
                : undefined
            }
          />
          <Stat
            label="win rate"
            value={
              bot && bot.trades > 0
                ? `${Math.round((bot.wins / bot.trades) * 100)}%`
                : "—"
            }
          />
          <Stat label="trades" value={bot ? String(bot.trades) : "—"} />
          <Stat label="fees paid" value={bot ? fmtUsd(bot.feesUsd) : "—"} />
          <Stat
            label="equity high"
            value={bot ? fmtUsd(bot.equityHighUsd) : "—"}
          />
        </div>

        {/* community bull/bear vote — same widget as the whale cards */}
        {onReact && (
          <div
            className="mt-4 rounded-2xl border p-3"
            style={{ borderColor: FAINT }}
          >
            <div
              className="text-[10px] font-black uppercase tracking-[0.24em]"
              style={{ color: DIM }}
            >
              community sentiment
            </div>
            <SentimentRow
              sentiment={sentiment ?? EMPTY_SENTIMENT}
              onReact={onReact}
            />
          </div>
        )}

        {/* open positions · live */}
        {openPositions.length > 0 && (
          <div className="mt-5">
            <div
              className="text-[10px] font-black uppercase tracking-[0.24em]"
              style={{ color: DIM }}
            >
              open positions · live
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {openPositions.map((pos) => {
                const markPrice = livePrice;
                const pnlPct = botPositionPnlPct(pos, markPrice);
                const long = pos.side === "long";
                const sideColor = long ? GREEN : RED;
                const pnlColor =
                  pnlPct === null ? DIM : pnlPct > 0 ? GREEN : pnlPct < 0 ? RED : DIM;
                const liveStyle = marketStale ? { opacity: 0.45 } : undefined;
                const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");
                return (
                  <div
                    key={`${pos.marketId}-${pos.side}-${pos.openedTsMs}`}
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
                      {pnlPct === null
                        ? "—"
                        : `${sign(pnlPct)}${Math.abs(pnlPct).toFixed(1)}%`}
                    </span>
                    <span style={{ color: DIM, ...liveStyle }}>
                      {markPrice !== null
                        ? `@ ${fmtArenaPrice(markPrice)}`
                        : `in ${fmtArenaPrice(pos.entryPrice)}`}{" "}
                      · liq {fmtArenaPrice(pos.liqPrice)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* decision tape */}
        <div className="mt-5">
          <div
            className="text-[10px] font-black uppercase tracking-[0.24em]"
            style={{ color: DIM }}
          >
            decision tape · on-chain
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            {tape.length === 0 ? (
              <div
                className="rounded-xl border border-dashed px-3 py-3 text-[10px] font-bold uppercase tracking-widest"
                style={{ borderColor: FAINT, color: DIM }}
              >
                no decisions yet — the strategy is waiting for its setup
              </div>
            ) : (
              tape.slice(0, 24).map((e, i) => {
                const act = arenaAction(e.action);
                return (
                  <div
                    key={`${e.tsMs}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[11px] font-bold tabular-nums"
                    style={{ borderColor: FAINT }}
                  >
                    <span
                      className="font-black uppercase tracking-widest"
                      style={{ color: TOKEN_COLORS[act.color] }}
                    >
                      {act.label}
                    </span>
                    <span style={{ color: DIM }}>
                      {fmtArenaPrice(e.price)} · {fmtUsd(e.stakeUsd)} stake
                    </span>
                    <span style={{ color: DIM }}>{fmtWhen(e.tsMs, now)}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* about + verify */}
        <div
          className="mt-5 rounded-2xl border p-3 text-[11px] leading-relaxed"
          style={{ borderColor: FAINT, color: DIM }}
        >
          Decisions are made by program code running in a MagicBlock Ephemeral
          Rollup; prices come from the Pyth Lazer oracle feed operated by
          MagicBlock.{" "}
          {isDevnetEndpoint(env?.endpoint)
            ? "Devnet demo."
            : "State is committed to Solana mainnet — check it yourself:"}
          {pda && (
            <div className="mt-2 flex flex-wrap gap-3">
              <a
                href={solscanAccountUrl(pda, env?.endpoint)}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
                style={{ color: FG }}
              >
                view raw bot account
                {isDevnetEndpoint(env?.endpoint) ? " (devnet)" : ""}
              </a>
              {env && (
                <a
                  href={solscanAccountUrl(env.programId.toBase58(), env.endpoint)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                  style={{ color: FG }}
                >
                  program
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <div
        className="text-[8px] font-black uppercase tracking-[0.2em]"
        style={{ color: DIM }}
      >
        {label}
      </div>
      <div
        className="mt-0.5 text-[14px] font-black leading-tight"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
