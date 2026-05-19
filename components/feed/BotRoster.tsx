"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageCircle, Zap } from "lucide-react";
import type { BotSignal } from "@/lib/types";
import type { MoodBadge } from "@/lib/bots/mood";
import { BotChatSheet } from "./BotChatSheet";
import { BalancePill } from "@/components/shell/BalancePill";
import { useLiveMarks } from "@/lib/pacifica/live-context";
import { computeLivePaperPnlPct } from "@/lib/bots/pnl";
import { usePulseOnChange } from "@/lib/feed/use-pulse-on-change";
import { TailModal, type TailSource } from "@/components/tail/TailModal";
import {
  BG,
  PANEL,
  PANEL_2,
  FG,
  ACCENT,
  GREEN,
  RED,
  DIM,
  FAINT,
  FONT_DISPLAY,
  StoryAvatar,
  Headline,
  BigNum,
} from "@/components/v2/ui";

// Bot list is refetched every 4s — fast enough that an open/close on
// the cron tick reaches the screen within a few seconds. Live PnL on
// the position chips updates on every WS mark tick (sub-second) via
// useLiveMark, so this poll only carries open/close events.
const POLL_MS = 4_000;

// Tagline + style copy per bot. Hardcoded by id — we only have 3 bots
// in the alpha-arena roster, and surfacing it gives each card a unique
// identity without needing a new DB column.
const BOT_META: Record<string, { tagline: string; style: string }> = {
  "momo-max-aggressive": {
    tagline: "Momentum hunter",
    style: "Breakout · 1m",
  },
  "mean-revert-mike": {
    tagline: "Mean reversion",
    style: "Z-fade · 1m",
  },
  "vol-vector-hair-trigger": {
    tagline: "Vol expansion",
    style: "Spike rider · 1m",
  },
};

const MOOD_META: Record<
  MoodBadge,
  { label: string; color: string }
> = {
  HUNTING: { label: "Hunting", color: GREEN },
  LOADED: { label: "Loaded", color: ACCENT },
  WOUNDED: { label: "Wounded", color: RED },
  ON_STREAK: { label: "On streak", color: "#ff8a2a" },
  DORMANT: { label: "Watching", color: FAINT },
  BUSTED: { label: "Busted", color: "#666" },
};

interface Props {
  initialBots: BotSignal[];
}

export function BotRoster({ initialBots }: Props) {
  const [bots, setBots] = useState<BotSignal[]>(initialBots);
  const [chatBotId, setChatBotId] = useState<string | null>(null);
  const [tailSource, setTailSource] = useState<TailSource | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/bots/roster", { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as { bots: BotSignal[] };
      setBots(data.bots);
    } catch {
      // swallow — keep last-good state
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        void load();
      }, POLL_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
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
  }, [load]);

  const chatBot = bots.find((b) => b.payload.botId === chatBotId) ?? null;

  return (
    <div
      className="relative flex h-full w-full flex-col"
      style={{
        background: BG,
        color: FG,
        fontFamily: FONT_DISPLAY,
      }}
    >
      <BalancePill />

      {/* Header */}
      <div className="px-5 pt-[72px] pb-3">
        <div className="flex items-end justify-between">
          <Headline size={42}>{`"ROSTER"`}</Headline>
          <div
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            <span
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
              style={{ background: GREEN, boxShadow: `0 0 6px ${GREEN}` }}
            />
            LIVE
          </div>
        </div>
      </div>

      {/* Roster scroll */}
      <div className="no-scrollbar flex-1 space-y-3 overflow-y-auto px-5 pb-32">
        {bots.map((bot, idx) => (
          <BotRow
            key={bot.payload.botId}
            bot={bot}
            rank={idx + 1}
            onChat={() => setChatBotId(bot.payload.botId)}
            onTail={(source) => setTailSource(source)}
          />
        ))}
      </div>

      {chatBot && (
        <BotChatSheet
          botId={chatBot.payload.botId}
          botName={chatBot.payload.botName}
          avatarEmoji={chatBot.payload.avatarEmoji}
          avatarImageUrl={chatBot.payload.avatarImageUrl}
          openingThoughts={chatBot.payload.currentPositions.map((pos) => ({
            asset: pos.asset,
            side: pos.side,
            narration: pos.narrationOpen,
          }))}
          onClose={() => setChatBotId(null)}
        />
      )}

      <TailModal
        open={!!tailSource}
        source={tailSource}
        onClose={() => setTailSource(null)}
      />
    </div>
  );
}

function BotRow({
  bot,
  rank,
  onChat,
  onTail,
}: {
  bot: BotSignal;
  rank: number;
  onChat: () => void;
  onTail: (source: TailSource) => void;
}) {
  const p = bot.payload;
  const meta = BOT_META[p.botId] ?? { tagline: "Strategy", style: "—" };
  const mood = p.mood;
  const moodMeta = mood ? MOOD_META[mood] : null;

  // Live marks come from the global Pacifica WS — sub-second ticks for
  // every subscribed symbol. We recompute each open position's live
  // PnL from those marks (falling back to the position's currentMark
  // shipped by the server when the WS hasn't seen that symbol yet)
  // and roll them up into a live equity figure. Replaces the static
  // snapshot the server sent at SSR time.
  const liveMarks = useLiveMarks();
  const livePositions = useMemo(() => {
    return p.currentPositions.map((pos) => {
      const liveMark = liveMarks[pos.asset] ?? pos.currentMark;
      const livePct = computeLivePaperPnlPct({
        side: pos.side,
        leverage: pos.leverage,
        entryMark: pos.entryMark,
        currentMark: liveMark,
        asset: pos.asset,
        stakeUsd: pos.stakeUsd,
      });
      return {
        ...pos,
        liveMark,
        livePaperPnlPct: livePct,
        livePaperPnlUsd: livePct * pos.stakeUsd,
      };
    });
  }, [p.currentPositions, liveMarks]);

  // Equity = cash + sum of unrealized PnL on every open position,
  // recalc'd from live marks. Lifetime % follows.
  const liveEquity =
    p.cashUsd +
    livePositions.reduce((s, pos) => s + pos.livePaperPnlUsd, 0);
  const lifetimePct =
    (liveEquity - p.startingBalanceUsd) / p.startingBalanceUsd;
  // Pulse the equity figure on every WS tick — drops the EQUITY number
  // out of "stale poll" mode and into "alive" mode.
  const equityPulse = usePulseOnChange(liveEquity);
  const equityPulseClass =
    equityPulse === "up"
      ? "pulse-up"
      : equityPulse === "down"
        ? "pulse-down"
        : "";

  return (
    <div
      className="relative"
      style={{
        background: PANEL,
        borderRadius: 22,
        border: `1px solid ${FAINT}`,
      }}
    >
      {/* Rank stripe — top-left corner */}
      <div
        className="absolute top-0 left-0 rounded-tl-[22px] rounded-br-2xl px-2.5 py-1 text-[10px] font-black uppercase tracking-widest"
        style={{
          background: rank === 1 ? ACCENT : PANEL_2,
          color: rank === 1 ? BG : FG,
        }}
      >
        #{rank}
      </div>

      <div className="px-3 pt-3.5 pb-3">
        {/* Top row: avatar + identity + mood + chat */}
        <div className="flex items-center gap-3 pl-9">
          <StoryAvatar
            emoji={p.avatarEmoji}
            imageUrl={p.avatarImageUrl}
            mood={mood ?? "DORMANT"}
            size={52}
            pulse={mood === "HUNTING"}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <Headline size={26}>{p.botName.toUpperCase()}</Headline>
              {p.busted && (
                <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: RED }}>
                  BUSTED
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              {meta.tagline} · {meta.style}
            </div>
          </div>
          <button
            type="button"
            onClick={onChat}
            className="rounded-full p-2"
            style={{ background: PANEL_2, color: FG, border: `1px solid ${FAINT}` }}
            aria-label="Open chat"
          >
            <MessageCircle size={14} strokeWidth={2.8} />
          </button>
        </div>

        {/* Equity row */}
        <div className="mt-3 flex items-baseline justify-between">
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              EQUITY
            </div>
            <div
              className={`mt-0.5 inline-block px-1 ${equityPulseClass}`}
            >
              <BigNum size={28}>
                ${liveEquity.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </BigNum>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              LIFETIME
            </div>
            <div className="mt-0.5">
              <BigNum size={22} color={lifetimePct >= 0 ? GREEN : RED}>
                {lifetimePct >= 0 ? "+" : ""}
                {(lifetimePct * 100).toFixed(1)}%
              </BigNum>
            </div>
          </div>
          {moodMeta && (
            <div
              className="ml-2 inline-flex items-center gap-1 self-end rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest"
              style={{
                background: `${moodMeta.color}1c`,
                color: moodMeta.color,
                border: `1px solid ${moodMeta.color}50`,
              }}
            >
              <span
                className="inline-block h-1 w-1 animate-pulse rounded-full"
                style={{ background: moodMeta.color }}
              />
              {moodMeta.label}
            </div>
          )}
        </div>

        {/* Stats strip */}
        <div
          className="mt-3 grid grid-cols-4 overflow-hidden"
          style={{
            background: PANEL_2,
            borderRadius: 12,
            border: `1px solid ${FAINT}`,
          }}
        >
          <StatCell label="24H" value={fmtPnl(p.stats.paperPnl24hUsd)} color={p.stats.paperPnl24hUsd >= 0 ? GREEN : RED} />
          <StatCell label="WR" value={p.stats.winRate === null ? "—" : `${(p.stats.winRate * 100).toFixed(0)}%`} />
          <StatCell label="TRDS" value={String(p.stats.totalTrades)} />
          <StatCell
            label="OPEN"
            value={`${livePositions.length}/04`}
            color={livePositions.length > 0 ? FG : DIM}
          />
        </div>

        {/* Positions row */}
        {livePositions.length > 0 ? (
          <div className="mt-3">
            <div className="mb-1.5 text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              NOW IN
            </div>
            <div className="flex flex-wrap gap-1.5">
              {livePositions.map((pos) => (
                <PositionChip
                  key={pos.positionId}
                  asset={pos.asset}
                  side={pos.side}
                  leverage={pos.leverage}
                  livePaperPnlPct={pos.livePaperPnlPct}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-3 text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
            WATCHING THE TAPE · ${p.freeBalanceUsd.toFixed(0)} FREE
          </div>
        )}

        {/* Tail CTA — opens the modal to pick amount + sign */}
        {livePositions.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const pos = livePositions[0];
              if (!pos) return;
              onTail({
                kind: "bot",
                botId: p.botId,
                botName: p.botName,
                avatarEmoji: p.avatarEmoji,
                avatarImageUrl: p.avatarImageUrl,
                asset: pos.asset,
                side: pos.side,
                leverage: pos.leverage,
                entryMark: pos.entryMark,
                positionId: pos.positionId,
              });
            }}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl py-2.5 text-[12px] font-black uppercase tracking-widest transition active:scale-[0.97]"
            style={{
              background: ACCENT,
              color: BG,
              boxShadow: `0 3px 0 ${ACCENT}99, inset 0 -2px 0 rgba(0,0,0,0.15)`,
            }}
          >
            <Zap size={12} strokeWidth={3} fill={BG} />
            TAIL {p.botName.toUpperCase()}
          </button>
        )}
      </div>
    </div>
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
      <div className="text-[8px] font-black uppercase tracking-widest" style={{ color: DIM }}>
        {label}
      </div>
      <div className="mt-0.5 text-[13px] font-black tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function PositionChip({
  asset,
  side,
  leverage,
  livePaperPnlPct,
}: {
  asset: string;
  side: "long" | "short";
  leverage: number;
  livePaperPnlPct: number;
}) {
  const isLong = side === "long";
  const profit = livePaperPnlPct >= 0;
  // Show percent so users don't confuse the bot's stake-denominated
  // dollar PnL with their own bankroll. % is also exactly the return
  // a tailer would see at the same leverage.
  const pctText = `${profit ? "+" : "-"}${Math.abs(livePaperPnlPct * 100).toFixed(1)}%`;
  return (
    <span
      className="inline-flex items-baseline gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wider tabular-nums"
      style={{
        background: PANEL_2,
        border: `1px solid ${isLong ? `${GREEN}55` : `${RED}55`}`,
        color: FG,
      }}
    >
      <span style={{ color: isLong ? GREEN : RED }}>
        {isLong ? "▲" : "▼"}
      </span>
      {asset}
      <span style={{ color: DIM, fontSize: "10px" }}>×{leverage}</span>
      <span style={{ color: profit ? GREEN : RED, fontSize: "10px" }}>
        {pctText}
      </span>
    </span>
  );
}

function fmtPnl(usd: number): string {
  const abs = Math.abs(usd);
  return `${usd >= 0 ? "+" : "-"}$${abs.toFixed(0)}`;
}
