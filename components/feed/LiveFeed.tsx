"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUp, MessageCircle, Zap } from "lucide-react";
import type { BotSignal } from "@/lib/types";
import { BotChatSheet } from "./BotChatSheet";
import { BalancePill } from "@/components/shell/BalancePill";
import { useLiveMarks } from "@/lib/pacifica/live-context";
import { computeLivePaperPnlPct } from "@/lib/bots/pnl";
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
  PnlPill,
  Stamp,
} from "@/components/v2/ui";

// Bot list polling: 4s, fast enough that opens/closes from the resolver
// tick appear within a single React paint of when they hit the DB.
// Live PnL on each card refreshes on every Pacifica WS mark tick.
const POLL_MS = 4_000;

interface FlatPosition {
  positionId: string;
  asset: string;
  side: "long" | "short";
  leverage: number;
  entryMark: number;
  currentMark: number;
  stakeUsd: number;
  livePaperPnlUsd: number;
  livePaperPnlPct: number;
  openSinceMs: number;
  narrationOpen: string | null;
  bot: {
    botId: string;
    botName: string;
    avatarEmoji: string;
    avatarImageUrl: string | null;
    mood: BotSignal["payload"]["mood"];
  };
  disagreements: Array<{
    botId: string;
    botName: string;
    avatarEmoji: string;
    avatarImageUrl: string | null;
  }>;
}

interface Props {
  initialBots: BotSignal[];
  botFilter: string | null;
}

function flatten(bots: BotSignal[], filter: string | null): FlatPosition[] {
  const out: FlatPosition[] = [];
  for (const bot of bots) {
    if (filter && bot.payload.botId !== filter) continue;
    for (const pos of bot.payload.currentPositions) {
      out.push({
        positionId: pos.positionId,
        asset: pos.asset,
        side: pos.side,
        leverage: pos.leverage,
        entryMark: pos.entryMark,
        currentMark: pos.currentMark,
        stakeUsd: pos.stakeUsd,
        livePaperPnlUsd: pos.livePaperPnlUsd,
        livePaperPnlPct: pos.livePaperPnlPct,
        openSinceMs: pos.openSinceMs,
        narrationOpen: pos.narrationOpen,
        bot: {
          botId: bot.payload.botId,
          botName: bot.payload.botName,
          avatarEmoji: bot.payload.avatarEmoji,
          avatarImageUrl: bot.payload.avatarImageUrl,
          mood: bot.payload.mood,
        },
        disagreements: pos.disagreements,
      });
    }
  }
  // Freshest first — newly-opened positions surface at the top.
  out.sort((a, b) => b.openSinceMs - a.openSinceMs);
  return out;
}

export function LiveFeed({ initialBots, botFilter }: Props) {
  const [bots, setBots] = useState<BotSignal[]>(initialBots);
  const [chatBotId, setChatBotId] = useState<string | null>(null);
  const [tailSource, setTailSource] = useState<TailSource | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [newCount, setNewCount] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const liveMarks = useLiveMarks();

  // Server-shipped positions, flattened from BotSignal[] and sorted by
  // freshness. Recomputed whenever the bot snapshot from the API poll
  // changes (open/close/equity moves).
  const baseFlat = useMemo(
    () => flatten(bots, botFilter),
    [bots, botFilter],
  );

  // Layer live WS marks on top — PnL ticks sub-second without a
  // network round-trip. The server-supplied `currentMark` is the
  // fallback for symbols the WS hasn't sent yet (cold open).
  const positions = useMemo(() => {
    return baseFlat.map((pos) => {
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
        currentMark: liveMark,
        livePaperPnlPct: livePct,
        livePaperPnlUsd: livePct * pos.stakeUsd,
      };
    });
  }, [baseFlat, liveMarks]);

  // Track which position IDs we've already shown the user. When the
  // bot poll brings new ones in (a fresh open landed) we surface a
  // pill: "↑ N new — tap to jump" so they can hop to the top without
  // needing a manual scroll up.
  const seenIdsRef = useRef<Set<string>>(
    new Set(baseFlat.map((p) => p.positionId)),
  );
  useEffect(() => {
    const incoming = baseFlat.map((p) => p.positionId);
    let added = 0;
    for (const id of incoming) {
      if (!seenIdsRef.current.has(id)) {
        seenIdsRef.current.add(id);
        added += 1;
      }
    }
    if (added > 0 && activeIdx > 0) {
      setNewCount((n) => n + added);
    } else if (added > 0 && activeIdx === 0) {
      // User is already at the top — new positions are right under
      // their nose, no pill needed.
      setNewCount(0);
    }
  }, [baseFlat, activeIdx]);

  const jumpToTop = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, behavior: "smooth" });
    setNewCount(0);
  }, []);

  // Auto-clear the pill once the user scrolls back to the top —
  // they're now looking at the new positions, no point pestering.
  useEffect(() => {
    if (activeIdx === 0 && newCount > 0) {
      setNewCount(0);
    }
  }, [activeIdx, newCount]);

  // Observe which card the snap-scroll has settled on. Used by the
  // new-position pill (only show when user is past slide 0) and would
  // also be the hook for future analytics.
  useEffect(() => {
    const els = itemRefs.current.filter((el): el is HTMLDivElement => !!el);
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const idx = Number((visible.target as HTMLElement).dataset.idx);
        if (Number.isFinite(idx)) setActiveIdx(idx);
      },
      { threshold: [0.6] },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [positions.length]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/bots/roster", { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as { bots: BotSignal[] };
      setBots(data.bots);
    } catch {
      // swallow
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
    start();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else start();
    });
    return () => {
      stop();
      document.removeEventListener("visibilitychange", () => {});
    };
  }, [load]);

  const chatBot = bots.find((b) => b.payload.botId === chatBotId) ?? null;

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        background: BG,
        color: FG,
        fontFamily: FONT_DISPLAY,
      }}
    >
      <BalancePill />

      {/* Back / filter pill — fixed top-left */}
      <div className="pointer-events-none absolute top-[18px] left-3 z-30">
        <Link
          href="/feed"
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest"
          style={{
            background: PANEL,
            color: FG,
            border: `1px solid ${FAINT}`,
          }}
        >
          <ArrowLeft size={11} strokeWidth={3} />
          ROSTER
        </Link>
      </div>

      {/* New-position pill — fires when the bot poll brings in fresh
          opens while the user is scrolled past slide 0. Tap to jump
          to the top and dismiss. */}
      {newCount > 0 && (
        <button
          type="button"
          onClick={jumpToTop}
          className="absolute top-[68px] left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-widest shadow-lg transition active:scale-[0.97]"
          style={{
            background: ACCENT,
            color: BG,
            boxShadow: `0 6px 18px ${ACCENT}55`,
            fontFamily: FONT_DISPLAY,
          }}
        >
          <ArrowUp size={12} strokeWidth={3} />
          {newCount} NEW
        </button>
      )}

      {positions.length === 0 ? (
        <EmptyState filter={botFilter} />
      ) : (
        <div
          ref={scrollerRef}
          className="no-scrollbar h-full w-full snap-y snap-mandatory overflow-y-scroll"
          style={{ scrollSnapStop: "always" }}
        >
          {positions.map((pos, i) => (
            <div
              key={pos.positionId}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              data-idx={i}
              className="h-full w-full snap-start"
            >
              <PositionCard
                pos={pos}
                slideIndex={i}
                total={positions.length}
                onChat={() => setChatBotId(pos.bot.botId)}
                onTail={() =>
                  setTailSource({
                    kind: "bot",
                    botId: pos.bot.botId,
                    botName: pos.bot.botName,
                    avatarEmoji: pos.bot.avatarEmoji,
                    avatarImageUrl: pos.bot.avatarImageUrl,
                    asset: pos.asset,
                    side: pos.side,
                    leverage: pos.leverage,
                    entryMark: pos.entryMark,
                    positionId: pos.positionId,
                  })
                }
              />
            </div>
          ))}
        </div>
      )}

      {chatBot && (
        <BotChatSheet
          botId={chatBot.payload.botId}
          botName={chatBot.payload.botName}
          avatarEmoji={chatBot.payload.avatarEmoji}
          avatarImageUrl={chatBot.payload.avatarImageUrl}
          openingThoughts={chatBot.payload.currentPositions.map((p) => ({
            asset: p.asset,
            side: p.side,
            narration: p.narrationOpen,
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

function EmptyState({ filter }: { filter: string | null }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-8 text-center">
      <Headline size={36}>{`"WATCHING THE TAPE"`}</Headline>
      <p
        className="mt-3 text-[11px] font-black uppercase tracking-widest"
        style={{ color: DIM }}
      >
        {filter
          ? "THIS OPERATOR HAS NO OPEN POSITIONS"
          : "NO OPEN POSITIONS · COME BACK IN A MINUTE"}
      </p>
      <Link
        href="/feed"
        className="mt-5 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-widest"
        style={{
          background: PANEL,
          color: FG,
          border: `1px solid ${FAINT}`,
        }}
      >
        <ArrowLeft size={11} strokeWidth={3} />
        BACK TO ROSTER
      </Link>
    </div>
  );
}

function PositionCard({
  pos,
  slideIndex,
  total,
  onChat,
  onTail,
}: {
  pos: FlatPosition;
  slideIndex: number;
  total: number;
  onChat: () => void;
  onTail: () => void;
}) {
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const isLong = pos.side === "long";
  const profit = pos.livePaperPnlUsd >= 0;
  const fresh = now > 0 && now - pos.openSinceMs < 15 * 60 * 1000;

  // Staking is handled by TailModal — opened via onTail() from the
  // TAIL CTA at the bottom of this card.

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden px-5 pt-[72px] pb-24"
      style={{ background: BG }}
    >
      {/* Top stamp row */}
      <div className="flex items-baseline justify-between pl-[80px]">
        <Stamp
          label="POS"
          value={`${String(slideIndex + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`}
        />
        <Stamp label="OP" value={pos.bot.botName.toUpperCase()} />
      </div>

      {/* Identity strip — bot avatar + name + chat */}
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={onChat} aria-label="Open chat">
          <StoryAvatar
            emoji={pos.bot.avatarEmoji}
            imageUrl={pos.bot.avatarImageUrl}
            mood={pos.bot.mood ?? "DORMANT"}
            size={56}
            pulse={pos.bot.mood === "HUNTING"}
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
            {pos.bot.botName.toUpperCase()} IS IN
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <Headline size={36}>{pos.asset}</Headline>
            <span
              className="rounded px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wide"
              style={{
                background: isLong ? `${GREEN}25` : `${RED}25`,
                color: isLong ? GREEN : RED,
              }}
            >
              {pos.side}
            </span>
            <span
              className="text-[12px] font-bold"
              style={{ color: DIM, fontFamily: "system-ui, sans-serif" }}
            >
              ×{pos.leverage}
            </span>
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

      {/* Spec strip */}
      <div
        className="mt-4 grid grid-cols-3 overflow-hidden"
        style={{
          background: PANEL,
          borderRadius: 16,
          border: `1px solid ${FAINT}`,
        }}
      >
        <SpecCell label="STAKE" value={`$${pos.stakeUsd.toFixed(0)}`} />
        <SpecCell label="ENTRY" value={fmtPrice(pos.entryMark)} bordered />
        <SpecCell
          label="NOW"
          value={fmtPrice(pos.currentMark)}
          color={profit ? GREEN : RED}
        />
      </div>

      {/* Live PnL row */}
      <div className="mt-3 flex items-center justify-between">
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
            LIVE P/L
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <PnlPill pnlUsd={pos.livePaperPnlUsd} size={20} />
            <span
              className="text-[14px] font-black tabular-nums"
              style={{
                color: profit ? GREEN : RED,
                fontFamily: "system-ui, sans-serif",
              }}
            >
              {profit ? "+" : ""}
              {(pos.livePaperPnlPct * 100).toFixed(1)}%
            </span>
          </div>
        </div>
        <div
          className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest"
          style={{ color: DIM }}
        >
          {fresh && (
            <span
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
              style={{ background: ACCENT, boxShadow: `0 0 6px ${ACCENT}` }}
            />
          )}
          OPENED {fmtAge(pos.openSinceMs, now)}
        </div>
      </div>

      {/* Narration */}
      {pos.narrationOpen && (
        <div
          className="mt-3 rounded-2xl px-3 py-3"
          style={{
            background: PANEL,
            border: `1px solid ${FAINT}`,
          }}
        >
          <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
            THESIS
          </div>
          <p
            className="mt-1 italic leading-snug"
            style={{
              fontFamily: "system-ui, sans-serif",
              fontSize: "14px",
              color: FG,
              opacity: 0.92,
            }}
          >
            {`"${pos.narrationOpen}"`}
          </p>
        </div>
      )}

      {/* Disagreements */}
      {pos.disagreements.length > 0 && (
        <div
          className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]"
          style={{ fontFamily: "system-ui, sans-serif" }}
        >
          <span
            className="text-[9px] font-black uppercase tracking-widest"
            style={{ color: DIM, fontFamily: FONT_DISPLAY }}
          >
            FADING IT
          </span>
          {pos.disagreements.map((d) => (
            <span
              key={d.botId}
              className="inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2 pl-0.5"
              style={{
                background: PANEL_2,
                border: `1px solid ${FAINT}`,
                color: FG,
              }}
            >
              {d.avatarImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={d.avatarImageUrl}
                  alt=""
                  className="h-4 w-4 rounded-full object-cover"
                  draggable={false}
                />
              ) : (
                <span>{d.avatarEmoji}</span>
              )}
              {d.botName}
            </span>
          ))}
        </div>
      )}

      <div className="flex-1" />

      {/* Tail CTA — opens the modal */}
      <div className="mt-3">
        <button
          type="button"
          onClick={onTail}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 font-black tracking-wide transition active:scale-[0.97]"
          style={{
            background: ACCENT,
            color: BG,
            fontSize: "15px",
            boxShadow: `0 3px 0 ${ACCENT}99, inset 0 -2px 0 rgba(0,0,0,0.15)`,
          }}
        >
          <Zap size={14} strokeWidth={3} fill={BG} />
          TAIL {pos.bot.botName.toUpperCase()}
        </button>
      </div>
    </div>
  );
}

function SpecCell({
  label,
  value,
  color = FG,
  bordered = false,
}: {
  label: string;
  value: string;
  color?: string;
  bordered?: boolean;
}) {
  return (
    <div
      className={`px-3 py-3 ${bordered ? "border-x" : ""}`}
      style={{ borderColor: FAINT }}
    >
      <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
        {label}
      </div>
      <div
        className="mt-1 text-[18px] font-black tabular-nums"
        style={{ color, fontFamily: FONT_DISPLAY }}
      >
        {value}
      </div>
    </div>
  );
}

function fmtPrice(v: number): string {
  if (v >= 1000) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toPrecision(4)}`;
}

function fmtAge(ms: number, now: number): string {
  if (now === 0) return "JUST NOW";
  const diff = Math.max(0, now - ms);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "JUST NOW";
  if (m < 60) return `${m}M AGO`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}H AGO`;
  const d = Math.floor(h / 24);
  return `${d}D AGO`;
}
