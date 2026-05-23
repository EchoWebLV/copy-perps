"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Zap } from "lucide-react";
import type { WhalePositionSignal } from "@/lib/types";
import { BalancePill } from "@/components/shell/BalancePill";
import { TailModal, type TailSource } from "@/components/tail/TailModal";
import {
  ACCENT,
  BG,
  BigNum,
  DIM,
  FAINT,
  FG,
  FONT_DISPLAY,
  GREEN,
  Headline,
  PANEL,
  PANEL_2,
  RED,
  Stamp,
  StoryAvatar,
} from "@/components/v2/ui";

const POLL_MS = 4_000;
const BODY_FONT = "system-ui, -apple-system, 'Inter', sans-serif";

interface Props {
  initialPositions: WhalePositionSignal[];
}

export function WhaleLiveFeed({ initialPositions }: Props) {
  const [positions, setPositions] =
    useState<WhalePositionSignal[]>(initialPositions);
  const [tailSource, setTailSource] = useState<TailSource | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/whales/live", { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as { positions: WhalePositionSignal[] };
      setPositions(data.positions);
    } catch {
      // Keep last good live snapshot.
    }
  }, []);

  useVisiblePoll(load, POLL_MS);

  const sorted = useMemo(
    () => [...positions].sort((a, b) => b.payload.openedAtMs - a.payload.openedAtMs),
    [positions],
  );

  useEffect(() => {
    const els = itemRefs.current.filter((el): el is HTMLDivElement => !!el);
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const idx = Number((visible.target as HTMLElement).dataset.idx);
        if (Number.isFinite(idx)) setActiveIdx(idx);
      },
      { threshold: [0.6] },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sorted.length]);

  return (
    <div
      className="relative h-full w-full overflow-hidden lg:h-dvh"
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      <BalancePill />

      <div className="pointer-events-none absolute top-[18px] left-3 z-30 lg:hidden">
        <Link
          href="/feed"
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest"
          style={{ background: PANEL, color: FG, border: `1px solid ${FAINT}` }}
        >
          <ArrowLeft size={11} strokeWidth={3} />
          WHALES
        </Link>
      </div>

      <div
        className="pointer-events-none absolute top-[18px] right-3 z-30 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest lg:hidden"
        style={{ background: PANEL, color: FG, border: `1px solid ${FAINT}` }}
      >
        LIVE POSITIONS
      </div>

      {sorted.length === 0 ? (
        <EmptyLive />
      ) : (
        <>
          <div
            ref={scrollerRef}
            className="no-scrollbar h-full w-full snap-y snap-mandatory overflow-y-scroll lg:hidden"
            style={{ scrollSnapStop: "always" }}
          >
            {sorted.map((position, i) => (
              <div
                key={position.payload.positionId}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                data-idx={i}
                className="h-full w-full snap-start"
              >
                <PositionCard
                  position={position}
                  slideIndex={i}
                  total={sorted.length}
                  onTail={() => setTailSource(toTailSource(position.payload))}
                />
              </div>
            ))}
          </div>

          <div className="hidden h-full min-h-0 grid-cols-[360px_minmax(0,1fr)] gap-4 p-6 lg:grid">
            <aside className="min-h-0 overflow-hidden rounded-2xl p-4" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
              <div className="mb-4">
                <Headline size={28}>{`"LIVE POSITIONS"`}</Headline>
                <p className="mt-1 text-[11px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                  Open source positions
                </p>
              </div>
              <div className="no-scrollbar space-y-2 overflow-y-auto">
                {sorted.map((position, i) => (
                  <button
                    key={position.payload.positionId}
                    type="button"
                    onClick={() => setActiveIdx(i)}
                    className="w-full rounded-xl px-3 py-3 text-left"
                    style={{
                      background: activeIdx === i ? PANEL_2 : BG,
                      border: `1px solid ${activeIdx === i ? ACCENT : FAINT}`,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-black uppercase">
                        {position.payload.displayName}
                      </span>
                      <FreshnessBadge stale={position.payload.stale} />
                    </div>
                    <div className="mt-1 text-[11px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                      {position.payload.market} {position.payload.side} {position.payload.leverage}x
                    </div>
                  </button>
                ))}
              </div>
            </aside>

            <section className="min-h-0 overflow-hidden rounded-2xl" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
              <PositionCard
                position={sorted[Math.min(activeIdx, sorted.length - 1)]}
                slideIndex={Math.min(activeIdx, sorted.length - 1)}
                total={sorted.length}
                onTail={() =>
                  setTailSource(
                    toTailSource(sorted[Math.min(activeIdx, sorted.length - 1)].payload),
                  )
                }
              />
            </section>
          </div>
        </>
      )}

      <TailModal
        open={!!tailSource}
        source={tailSource}
        onClose={() => setTailSource(null)}
      />
    </div>
  );
}

function PositionCard({
  position,
  slideIndex,
  total,
  onTail,
}: {
  position: WhalePositionSignal;
  slideIndex: number;
  total: number;
  onTail: () => void;
}) {
  const [now, setNow] = useState(0);
  const p = position.payload;
  const isLong = p.side === "long";
  const sideColor = isLong ? GREEN : RED;
  const pnl = p.unrealizedPnlPct;
  const profit = (pnl ?? 0) >= 0;

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden px-5 pt-[72px] pb-24 lg:px-8 lg:pt-8 lg:pb-8" style={{ background: BG }}>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="flex items-baseline justify-between pl-[80px] lg:pl-0">
          <Stamp
            label="POS"
            value={`${String(slideIndex + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`}
          />
          <Stamp label="SRC" value={p.source.toUpperCase()} />
        </div>

        <div className="mt-3 flex items-center gap-3">
          <StoryAvatar
            emoji={p.displayName.slice(0, 1).toUpperCase()}
            imageUrl={p.avatarUrl}
            mood={p.stale ? "WOUNDED" : "HUNTING"}
            size={56}
            pulse={!p.stale}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              {p.displayName.toUpperCase()}
            </div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <Headline size={36}>{p.market}</Headline>
              <span className="rounded px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wide" style={{ background: `${sideColor}25`, color: sideColor }}>
                {p.side}
              </span>
              <span className="text-[12px] font-black" style={{ color: DIM }}>
                {p.leverage}x
              </span>
            </div>
          </div>
          <FreshnessBadge stale={p.stale} />
        </div>

        <div className="mt-4 grid grid-cols-3 overflow-hidden" style={{ background: PANEL, borderRadius: 16, border: `1px solid ${FAINT}` }}>
          <SpecCell label="NOTIONAL" value={fmtUsd(p.notionalUsd)} />
          <SpecCell label="ENTRY" value={fmtPrice(p.entryPrice)} bordered />
          <SpecCell label="NOW" value={p.currentMark === null ? "N/A" : fmtPrice(p.currentMark)} color={profit ? GREEN : RED} />
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              SOURCE P/L
            </div>
            <div className="mt-1 text-[28px] font-black tabular-nums" style={{ color: profit ? GREEN : RED, fontFamily: BODY_FONT, lineHeight: 1 }}>
              {pnl === null ? "N/A" : `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%`}
            </div>
          </div>
          <div className="text-right text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
            <div>OPENED {fmtAge(p.openedAtMs, now)}</div>
            <div>SEEN {fmtAge(p.lastSeenAtMs, now)}</div>
          </div>
        </div>

        {p.analysis ? (
          <div className="mt-3 space-y-2">
            <AnalysisBlock label="Summary" value={p.analysis.summary} />
            <AnalysisBlock label="Risk" value={p.analysis.risk} tone="risk" />
            {p.analysis.entryGapWarning ? (
              <div className="flex gap-2 rounded-2xl px-3 py-3 text-[12px] leading-snug" style={{ background: `${ACCENT}12`, border: `1px solid ${ACCENT}45`, color: FG, fontFamily: BODY_FONT }}>
                <AlertTriangle size={15} strokeWidth={2.8} style={{ color: ACCENT }} />
                <span>{p.analysis.entryGapWarning}</span>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 rounded-2xl px-3 py-3 text-[12px] leading-snug" style={{ background: PANEL, border: `1px solid ${FAINT}`, color: DIM, fontFamily: BODY_FONT }}>
            Analysis is warming up for this source position.
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onTail}
        disabled={p.stale}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 font-black uppercase tracking-wide transition active:scale-[0.97] disabled:cursor-not-allowed"
        style={{
          background: p.stale ? "rgba(250,250,242,0.08)" : ACCENT,
          color: p.stale ? DIM : BG,
          fontSize: "15px",
          boxShadow: p.stale
            ? "none"
            : `0 3px 0 ${ACCENT}99, inset 0 -2px 0 rgba(0,0,0,0.15)`,
        }}
      >
        <Zap size={14} strokeWidth={3} fill={p.stale ? "none" : BG} />
        {p.stale ? "TAIL DISABLED" : `TAIL ${p.displayName.toUpperCase()}`}
      </button>
    </div>
  );
}

function toTailSource(position: WhalePositionSignal["payload"]): TailSource {
  return {
    kind: "whale",
    whaleId: position.whaleId,
    displayName: position.displayName,
    avatarUrl: position.avatarUrl,
    sourceAccount: position.sourceAccount,
    sourcePositionId: position.positionId,
    asset: position.market,
    side: position.side,
    leverage: position.leverage,
    entryMark: position.entryPrice,
    currentMark: position.currentMark,
    stale: position.stale,
    positions: [
      {
        sourcePositionId: position.positionId,
        asset: position.market,
        side: position.side,
        leverage: position.leverage,
        entryMark: position.entryPrice,
        currentMark: position.currentMark,
        stale: position.stale,
        notionalUsd: position.notionalUsd,
        unrealizedPnlPct: position.unrealizedPnlPct,
      },
    ],
  };
}

function useVisiblePoll(load: () => Promise<void>, intervalMs: number) {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let inFlight = false;
    const run = () => {
      if (inFlight) return;
      inFlight = true;
      void load().finally(() => {
        inFlight = false;
      });
    };
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        run();
      }, intervalMs);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
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
  }, [load, intervalMs]);
}

function FreshnessBadge({ stale }: { stale: boolean }) {
  return (
    <span className="shrink-0 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest" style={{ background: stale ? `${RED}18` : `${GREEN}18`, color: stale ? RED : GREEN, border: `1px solid ${stale ? `${RED}45` : `${GREEN}45`}` }}>
      {stale ? "STALE" : "FRESH"}
    </span>
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
    <div className={`px-3 py-3 ${bordered ? "border-x" : ""}`} style={{ borderColor: FAINT }}>
      <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
        {label}
      </div>
      <div className="mt-1 text-[18px] font-black tabular-nums" style={{ color, fontFamily: FONT_DISPLAY }}>
        {value}
      </div>
    </div>
  );
}

function AnalysisBlock({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  tone?: "normal" | "risk";
}) {
  return (
    <div className="rounded-2xl px-3 py-3" style={{ background: PANEL, border: `1px solid ${tone === "risk" ? `${RED}35` : FAINT}` }}>
      <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: tone === "risk" ? RED : DIM }}>
        {label}
      </div>
      <p className="mt-1 text-[13px] leading-snug" style={{ color: FG, opacity: 0.92, fontFamily: BODY_FONT }}>
        {value}
      </p>
    </div>
  );
}

function EmptyLive() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-8 text-center">
      <Headline size={34}>{`"NO WHALE POSITIONS"`}</Headline>
      <p className="mt-3 text-[11px] font-black uppercase tracking-widest" style={{ color: DIM }}>
        Open positions will appear after the next source refresh
      </p>
      <Link href="/feed" className="mt-5 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-widest" style={{ background: PANEL, color: FG, border: `1px solid ${FAINT}` }}>
        <ArrowLeft size={12} strokeWidth={3} />
        BACK TO WHALES
      </Link>
    </div>
  );
}

function fmtUsd(v: number): string {
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPrice(v: number): string {
  if (v >= 1000) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toPrecision(4)}`;
}

function fmtAge(ms: number, now: number): string {
  if (now === 0) return "JUST NOW";
  const diff = Math.max(0, now - ms);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "JUST NOW";
  if (minutes < 60) return `${minutes}M AGO`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}H AGO`;
  return `${Math.floor(hours / 24)}D AGO`;
}
