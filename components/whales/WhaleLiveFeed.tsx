"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Zap } from "lucide-react";
import type { WhalePositionSignal } from "@/lib/types";
import { isSourceFresh } from "@/lib/whales/identity";
import { LiveEntryChart } from "@/components/feed/LiveEntryChart";
import { useLiveMarks } from "@/lib/pacifica/live-context";
import { BalancePill } from "@/components/shell/BalancePill";
import { TailModal, type TailSource } from "@/components/tail/TailModal";
import { isFlashCopyableMarket } from "@/lib/flash/markets";
import { WhaleFingerprintAvatar } from "./WhaleFingerprintAvatar";
import {
  ACCENT,
  BG,
  DIM,
  FAINT,
  FG,
  FONT_DISPLAY,
  GREEN,
  Headline,
  PANEL,
  PANEL_2,
  RED,
  STREAK,
  Stamp,
} from "@/components/v2/ui";
import {
  computeWhalePositionPnlPct,
  toWhaleEntryChartPosition,
} from "./whale-entry-chart-position";
import { buildWhaleLiveTailButtonLabel } from "./whale-live-tail-label";
import { formatWhalePositionTime } from "./whale-position-age";

const POLL_MS = 4_000;
const BODY_FONT = "system-ui, -apple-system, 'Inter', sans-serif";
const PNL_BRUSH_STROKES = [
  {
    clipPath: "polygon(2% 18%, 99% 4%, 94% 82%, 5% 96%)",
    transform: "rotate(-2deg)",
  },
  {
    clipPath: "polygon(4% 5%, 96% 16%, 99% 88%, 1% 78%)",
    transform: "rotate(1.5deg)",
  },
  {
    clipPath: "polygon(0 22%, 92% 0, 100% 72%, 7% 100%)",
    transform: "rotate(-0.75deg)",
  },
] as const;

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
  const liveMarks = useLiveMarks();

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
    () =>
      [...positions].sort(
        (a, b) => b.payload.openedAtMs - a.payload.openedAtMs,
      ),
    [positions],
  );
  const selectedIndex =
    sorted.length === 0 ? 0 : Math.min(activeIdx, sorted.length - 1);
  const selectedPosition = sorted[selectedIndex];

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
                  liveMark={liveMarks[position.payload.market]}
                  onTail={() =>
                    setTailSource(toTailSource(position.payload, Date.now()))
                  }
                />
              </div>
            ))}
          </div>

          <div className="hidden h-full min-h-0 grid-cols-[360px_minmax(0,1fr)] gap-4 p-6 lg:grid">
            <aside className="min-h-0 overflow-hidden rounded-2xl p-4" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
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
                position={selectedPosition}
                slideIndex={selectedIndex}
                total={sorted.length}
                liveMark={liveMarks[selectedPosition.payload.market]}
                onTail={() =>
                  setTailSource(
                    toTailSource(selectedPosition.payload, Date.now()),
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
  liveMark,
  onTail,
}: {
  position: WhalePositionSignal;
  slideIndex: number;
  total: number;
  liveMark?: number;
  onTail: () => void;
}) {
  const [now, setNow] = useState(0);
  const p = position.payload;
  const isLong = p.side === "long";
  const sideColor = isLong ? GREEN : RED;
  const currentMark = liveMark ?? p.currentMark;
  const pnl =
    currentMark === null
      ? p.unrealizedPnlPct
      : computeWhalePositionPnlPct({
          side: p.side,
          leverage: p.leverage,
          entryMark: p.entryPrice,
          currentMark,
        });
  const profit = (pnl ?? 0) >= 0;
  const chartPosition = toWhaleEntryChartPosition(p, liveMark);
  const stale =
    p.stale || (now > 0 && !isSourceFresh(p.lastSeenAtMs, undefined, now));
  const canTail = isFlashCopyableMarket(p.market);
  const positionTime = formatWhalePositionTime(p, now);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden px-5 pt-12 pb-24 lg:px-8 lg:pt-8 lg:pb-8" style={{ background: BG }}>
      <div className="flex min-h-0 flex-1 flex-col pr-1">
        <div className="flex items-baseline justify-between">
          <Stamp
            label="POS"
            value={`${String(slideIndex + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`}
          />
          <Stamp label="SRC" value={p.source.toUpperCase()} />
        </div>

        <div className="mt-3 flex items-center gap-3">
          <WhaleFingerprintAvatar
            sourceAccount={p.sourceAccount}
            label={p.displayName}
            mood={stale ? "WOUNDED" : "HUNTING"}
            size={56}
            pulse={!stale}
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
          <FreshnessBadge stale={stale} />
        </div>

        <div className="mt-4 grid grid-cols-3 overflow-hidden" style={{ background: PANEL, borderRadius: 16, border: `1px solid ${FAINT}` }}>
          <SpecCell label="NOTIONAL" value={fmtUsd(p.notionalUsd)} />
          <SpecCell label="ENTRY PRICE" value={fmtPrice(p.entryPrice)} bordered />
          <SpecCell label="NOW" value={currentMark === null ? "N/A" : fmtPrice(currentMark)} color={profit ? GREEN : RED} />
        </div>

        {chartPosition ? (
          <LiveEntryChart pos={chartPosition} />
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              SOURCE P/L
            </div>
            <PnlBrushStroke
              pnl={pnl}
              profit={profit}
              seed={p.positionId}
            />
          </div>
          <div className="text-right text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
            <div>{positionTime.label.toUpperCase()} {positionTime.value}</div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onTail}
        disabled={!canTail}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 font-black uppercase tracking-wide transition active:scale-[0.97] disabled:cursor-not-allowed"
        style={{
          background: canTail ? ACCENT : "rgba(250,250,242,0.08)",
          color: canTail ? BG : DIM,
          fontSize: "15px",
          boxShadow: canTail
            ? `0 3px 0 ${ACCENT}99, inset 0 -2px 0 rgba(0,0,0,0.15)`
            : "none",
        }}
      >
        <Zap size={14} strokeWidth={3} fill={canTail ? BG : "none"} />
        {buildWhaleLiveTailButtonLabel({
          stale,
          copyableOnPacifica: p.copyableOnPacifica,
        })}
      </button>
    </div>
  );
}

function toTailSource(
  position: WhalePositionSignal["payload"],
  nowMs = Date.now(),
): TailSource {
  const stale =
    position.stale ||
    !isSourceFresh(position.lastSeenAtMs, undefined, nowMs);
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
    maxLeverage: position.maxLeverage,
    entryMark: position.entryPrice,
    currentMark: position.currentMark,
    stale,
    lastSeenAtMs: position.lastSeenAtMs,
    positions: [
      {
        sourcePositionId: position.positionId,
        asset: position.market,
        side: position.side,
        leverage: position.leverage,
        maxLeverage: position.maxLeverage,
        entryMark: position.entryPrice,
        currentMark: position.currentMark,
        stale,
        lastSeenAtMs: position.lastSeenAtMs,
        copyableOnPacifica: position.copyableOnPacifica,
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
  // "Delayed" = our snapshot is aging, not that the trade is dead — amber,
  // not alarm-red.
  return (
    <span className="shrink-0 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest" style={{ background: stale ? `${STREAK}14` : `${GREEN}18`, color: stale ? STREAK : GREEN, border: `1px solid ${stale ? `${STREAK}38` : `${GREEN}45`}` }}>
      {stale ? "DELAYED" : "LIVE"}
    </span>
  );
}

function brushVariant(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash + seed.charCodeAt(i)) % PNL_BRUSH_STROKES.length;
  }
  return PNL_BRUSH_STROKES[hash] ?? PNL_BRUSH_STROKES[0];
}

function formatSourcePnl(pnl: number | null): string {
  if (pnl === null) return "N/A";
  return `${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%`;
}

function PnlBrushStroke({
  pnl,
  profit,
  seed,
}: {
  pnl: number | null;
  profit: boolean;
  seed: string;
}) {
  const variant = brushVariant(seed);
  return (
    <div
      className="mt-1 inline-flex origin-left px-3 py-2"
      style={{
        ...variant,
        background: "#f5d84b",
        boxShadow: "0 8px 18px rgba(245,216,75,0.16)",
      }}
    >
      <span
        className="tabular-nums text-[34px] font-black"
        style={{
          color: profit ? "#082615" : "#3a090f",
          fontFamily: BODY_FONT,
          lineHeight: 1,
          textShadow: "0 1px 0 rgba(255,255,255,0.25)",
        }}
      >
        {formatSourcePnl(pnl)}
      </span>
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
