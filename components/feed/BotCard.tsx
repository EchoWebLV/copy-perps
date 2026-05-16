"use client";

import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { MessageCircle } from "lucide-react";
import type { BotSignal, StakeAmount } from "@/lib/types";
import type { MoodBadge } from "@/lib/bots/mood";
import { usePulseOnChange } from "@/lib/feed/use-pulse-on-change";
import { useLiveMarks } from "@/lib/pacifica/live-context";
import { computeLivePaperPnlPct } from "@/lib/bots/pnl";
import { BotChatSheet } from "./BotChatSheet";
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
  PnlPill,
  Stamp,
} from "@/components/v2/ui";

const STAKES: StakeAmount[] = [5, 10, 20, 50];

interface Props {
  signal: BotSignal;
  slideIndex?: number;
}

function fmtPrice(v: number): string {
  if (v >= 1000) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toPrecision(4)}`;
}

// Live-tick variant: always show enough decimals that sub-second WS
// updates change a visible digit. Pairs with usePulseOnChange so the
// number both flashes AND visually moves on each tick.
function fmtLivePrice(v: number): string {
  if (v >= 1000) return `$${v.toFixed(2)}`;
  if (v >= 1) return `$${v.toFixed(3)}`;
  return `$${v.toPrecision(5)}`;
}

function fmtAge(ms: number, now: number): string {
  if (now === 0) return "just now";
  const diff = Math.max(0, now - ms);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

const MOOD_META: Record<
  MoodBadge,
  { label: string; emoji: string; color: string }
> = {
  HUNTING: { label: "Hunting", emoji: "🎯", color: GREEN },
  LOADED: { label: "Loaded", emoji: "⚡", color: ACCENT },
  WOUNDED: { label: "Wounded", emoji: "💀", color: RED },
  ON_STREAK: { label: "On streak", emoji: "🔥", color: "#ff8a2a" },
  DORMANT: { label: "Watching", emoji: "😴", color: FAINT },
  BUSTED: { label: "Busted", emoji: "🪦", color: "#666" },
};

export function BotCard({ signal, slideIndex = 0 }: Props) {
  const { getAccessToken } = usePrivy();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  const p = signal.payload;
  const mood = p.mood;
  const moodMeta = mood ? MOOD_META[mood] : null;

  // Overlay live Pacifica WS marks on the server-shipped positions so
  // currentMark + PnL tick sub-second. Falls back to the server value
  // for assets the WS hasn't seen yet. The same overlay drives both
  // per-position PositionRow pulses and the BANKROLL/LIFETIME figures.
  const liveMarks = useLiveMarks();
  const positions = useMemo(() => {
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
        currentMark: liveMark,
        livePaperPnlPct: livePct,
        livePaperPnlUsd: livePct * pos.stakeUsd,
      };
    });
  }, [p.currentPositions, liveMarks]);

  // Equity = cash + sum of unrealized PnL across open positions, all
  // priced from live marks. This is what makes the BANKROLL chip move
  // continuously instead of jumping every 4s when the bot poll lands.
  const liveEquity =
    p.cashUsd + positions.reduce((s, pos) => s + pos.livePaperPnlUsd, 0);
  const lifetimePct =
    (liveEquity - p.startingBalanceUsd) / p.startingBalanceUsd;
  const equityPulse = usePulseOnChange(liveEquity);
  const equityPulseClass =
    equityPulse === "up"
      ? "pulse-up"
      : equityPulse === "down"
        ? "pulse-down"
        : "";

  async function onStake(
    positionId: string,
    asset: string,
    side: "long" | "short",
    leverage: number,
    stakeUsdc: StakeAmount,
  ) {
    const key = `${positionId}-${stakeUsdc}`;
    if (busyKey) return;
    setBusyKey(key);
    setStatus("PLACING ORDER…");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("not authed");

      const resp = await fetch("/api/bet/bot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          botId: p.botId,
          market: asset,
          side,
          leverage,
          stakeUsdc,
          signalId: signal.id,
        }),
      });

      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? `HTTP ${resp.status}`);
      }

      const data = (await resp.json()) as {
        fill?: { avgFillPrice?: string | number };
      };
      const price = data.fill?.avgFillPrice;
      setStatus(
        price
          ? `OPENED ${asset} ${side.toUpperCase()} ${leverage}× @ $${Number(price).toFixed(4)}`
          : `OPENED ${asset} ${side.toUpperCase()} ${leverage}×`,
      );
    } catch (err) {
      console.error("[bot] stake failed:", err);
      setStatus(`FAILED: ${String(err).slice(0, 80)}`);
    } finally {
      setBusyKey(null);
      setTimeout(() => setStatus(null), 5000);
    }
  }

  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden px-5 pt-[72px] pb-24"
      data-card-type="bot"
      style={{
        background: BG,
        color: FG,
        fontFamily: FONT_DISPLAY,
      }}
    >
      {/* Top stamp row */}
      <div className="flex items-baseline justify-between">
        <Stamp label="NO." value={`${String(slideIndex + 1).padStart(2, "0")} / 12`} />
        <Stamp label="SKU" value={p.botId.toUpperCase().slice(0, 14)} />
      </div>

      {/* Identity row: headline + story-ring avatar */}
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Stamp label={`"PAPER OPERATOR"`} />
          <div className="mt-1">
            <Headline size={42}>{`"${p.botName}"`}</Headline>
          </div>
        </div>
        <StoryAvatar
          emoji={p.avatarEmoji}
          imageUrl={p.avatarImageUrl}
          mood={mood ?? "DORMANT"}
          size={64}
          pulse={mood === "HUNTING"}
        />
      </div>

      {/* Mood + chat row */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {moodMeta && (
          <div
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest"
            style={{
              background: `${moodMeta.color}1c`,
              color: moodMeta.color,
              border: `1px solid ${moodMeta.color}50`,
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
              style={{ background: moodMeta.color }}
            />
            {moodMeta.label.toUpperCase()}
          </div>
        )}
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest"
          style={{ background: PANEL_2, color: FG, border: `1px solid ${FAINT}` }}
        >
          <MessageCircle size={11} strokeWidth={2.8} />
          CHAT
        </button>
      </div>

      {/* Spec card: BANKROLL / LIFETIME / OPEN */}
      <div
        className="mt-3 grid grid-cols-3 gap-3 p-3"
        style={{
          background: PANEL,
          borderRadius: 18,
          border: `1px solid ${FAINT}`,
        }}
      >
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
            BANKROLL
          </div>
          <div className={`mt-1 inline-block px-1 ${equityPulseClass}`}>
            <BigNum size={22}>
              ${liveEquity.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </BigNum>
          </div>
        </div>
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
            LIFETIME
          </div>
          <div className={`mt-1 inline-block px-1 ${equityPulseClass}`}>
            <BigNum size={22} color={lifetimePct >= 0 ? GREEN : RED}>
              {lifetimePct >= 0 ? "+" : ""}
              {(lifetimePct * 100).toFixed(1)}%
            </BigNum>
          </div>
        </div>
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
            OPEN
          </div>
          <div className="mt-1">
            <BigNum size={22}>{String(positions.length).padStart(2, "0")}/04</BigNum>
          </div>
        </div>

        <div
          className="col-span-3 mt-1 flex items-baseline justify-between border-t pt-2 text-[10px] font-black uppercase tracking-widest"
          style={{ borderColor: FAINT, color: DIM }}
        >
          <span>
            WR{" "}
            <span style={{ color: FG }}>
              {p.stats.winRate === null
                ? "—"
                : `${(p.stats.winRate * 100).toFixed(0)}%`}
            </span>
          </span>
          <span>
            24H{" "}
            <span style={{ color: p.stats.paperPnl24hUsd >= 0 ? GREEN : RED }}>
              {p.stats.paperPnl24hUsd >= 0 ? "+" : "-"}$
              {Math.abs(p.stats.paperPnl24hUsd).toFixed(0)}
            </span>
          </span>
          <span>
            7D{" "}
            <span style={{ color: p.stats.paperPnl7dUsd >= 0 ? GREEN : RED }}>
              {p.stats.paperPnl7dUsd >= 0 ? "+" : "-"}$
              {Math.abs(p.stats.paperPnl7dUsd).toFixed(0)}
            </span>
          </span>
          <span>
            TRADES <span style={{ color: FG }}>{p.stats.totalTrades}</span>
          </span>
        </div>
      </div>

      {/* Positions section */}
      <div className="mt-3 flex flex-1 flex-col overflow-y-auto">
        {positions.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-center">
            <div>
              <Headline size={28}>{`"WATCHING THE TAPE"`}</Headline>
              <p
                className="mt-2 text-[10px] font-black uppercase tracking-widest"
                style={{ color: DIM }}
              >
                NO ACTIVE POSITIONS · ${p.freeBalanceUsd.toFixed(0)} FREE
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3 pb-3">
            {positions.map((pos) => (
              <PositionRow
                key={pos.positionId}
                pos={pos}
                now={now}
                busyKey={busyKey}
                onStake={onStake}
              />
            ))}
          </div>
        )}
      </div>

      {/* Status line */}
      {status && (
        <div
          className="text-center text-[10px] font-black uppercase tracking-widest"
          style={{ color: DIM }}
        >
          {status}
        </div>
      )}

      {chatOpen && (
        <BotChatSheet
          botId={p.botId}
          botName={p.botName}
          avatarEmoji={p.avatarEmoji}
          avatarImageUrl={p.avatarImageUrl}
          openingThoughts={positions.map((pos) => ({
            asset: pos.asset,
            side: pos.side,
            narration: pos.narrationOpen,
          }))}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  );
}

type BotPosition = BotSignal["payload"]["currentPositions"][number];

// One position row inside the BotCard. Lifted out so each position can
// own its own usePulseOnChange hooks — sub-second WS marks fire the
// pulse continuously, so the mark price + PnL pill flash green/red on
// every tick.
function PositionRow({
  pos,
  now,
  busyKey,
  onStake,
}: {
  pos: BotPosition;
  now: number;
  busyKey: string | null;
  onStake: (
    positionId: string,
    asset: string,
    side: "long" | "short",
    leverage: number,
    stakeUsdc: StakeAmount,
  ) => void;
}) {
  const isLong = pos.side === "long";
  const profit = pos.livePaperPnlUsd >= 0;
  const isFresh = now > 0 && now - pos.openSinceMs < 15 * 60 * 1000;
  const markPulse = usePulseOnChange(pos.currentMark);
  const pnlPulse = usePulseOnChange(pos.livePaperPnlUsd);
  const markPulseClass =
    markPulse === "up" ? "pulse-up" : markPulse === "down" ? "pulse-down" : "";

  return (
    <div
      className="p-3"
      style={{
        background: PANEL,
        borderRadius: 18,
        border: `1px solid ${FAINT}`,
      }}
    >
      {/* Top line: side chip + asset + lev + stake · age */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{
              background: isLong ? `${GREEN}25` : `${RED}25`,
              color: isLong ? GREEN : RED,
            }}
          >
            {pos.side}
          </span>
          <Headline size={22}>{pos.asset}</Headline>
          <span
            className="text-[12px] font-bold"
            style={{ color: DIM, fontFamily: "system-ui, sans-serif" }}
          >
            ×{pos.leverage}
          </span>
          <span
            className="rounded px-1.5 py-0.5 text-[11px] font-black tabular-nums"
            style={{
              background: PANEL_2,
              color: FG,
              border: `1px solid ${FAINT}`,
              fontFamily: "system-ui, sans-serif",
            }}
          >
            ${pos.stakeUsd.toFixed(0)}
          </span>
        </div>
        <span
          className="flex items-center gap-1.5 text-[11px]"
          style={{ color: DIM, fontFamily: "system-ui, sans-serif" }}
        >
          {isFresh && (
            <span
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
              style={{ background: ACCENT, boxShadow: `0 0 6px ${ACCENT}` }}
              aria-hidden
            />
          )}
          {fmtAge(pos.openSinceMs, now)}
        </span>
      </div>

      {/* Entry · Now · P/L — single tight line. "Now" + PnL flash on
          every WS tick via pulse-up/pulse-down. fmtLivePrice keeps a
          visible decimal moving so the digits also tick. */}
      <div
        className="mt-1.5 flex items-baseline justify-between gap-3 text-[12px]"
        style={{ fontFamily: "system-ui, sans-serif" }}
      >
        <div className="flex items-baseline gap-2 tabular-nums">
          <span style={{ color: DIM }}>Entry</span>
          <span style={{ color: FG }}>{fmtPrice(pos.entryMark)}</span>
          <span style={{ color: DIM }}>·</span>
          <span style={{ color: DIM }}>Now</span>
          <span
            className={`px-0.5 ${markPulseClass}`}
            style={{ color: profit ? GREEN : RED, display: "inline-block" }}
          >
            {fmtLivePrice(pos.currentMark)}
          </span>
        </div>
        <PnlPill pnlUsd={pos.livePaperPnlUsd} size={13} pulse={pnlPulse} />
      </div>

      {/* Narration */}
      {pos.narrationOpen && (
        <p
          className="mt-2 italic leading-snug"
          style={{
            fontFamily: "system-ui, sans-serif",
            fontSize: "13px",
            color: FG,
            opacity: 0.9,
          }}
        >
          {`"${pos.narrationOpen}"`}
        </p>
      )}

      {/* Disagreement badges */}
      {pos.disagreements.length > 0 && (
        <div
          className="mt-2 flex flex-wrap items-center gap-1 text-[11px]"
          style={{ fontFamily: "system-ui, sans-serif" }}
        >
          <span style={{ color: DIM }}>vs.</span>
          {pos.disagreements.map((d) => (
            <span
              key={d.botId}
              className="inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2 pl-0.5"
              style={{
                background: PANEL_2,
                border: `1px solid ${FAINT}`,
                color: FG,
              }}
              title={`${d.botName} disagrees with this trade`}
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

      {/* Stake buttons — chunky yellow Snapchat-style */}
      <div className="mt-3">
        <div className="flex gap-2">
          {STAKES.map((s) => {
            const key = `${pos.positionId}-${s}`;
            const thisIsBusy = busyKey === key;
            return (
              <button
                key={s}
                type="button"
                disabled={busyKey !== null}
                onClick={() =>
                  onStake(
                    pos.positionId,
                    pos.asset,
                    pos.side,
                    pos.leverage,
                    s,
                  )
                }
                className="flex-1 rounded-2xl py-2 font-black tracking-wide transition active:scale-[0.97] disabled:opacity-40"
                style={{
                  background: ACCENT,
                  color: BG,
                  fontSize: "13px",
                  boxShadow: `0 3px 0 ${ACCENT}99, inset 0 -2px 0 rgba(0,0,0,0.15)`,
                }}
              >
                {thisIsBusy ? "…" : `$${s}`}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
