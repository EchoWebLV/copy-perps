"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Radio } from "lucide-react";
import type { WhalePositionSignal } from "@/lib/types";
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
  StoryAvatar,
} from "@/components/v2/ui";

const POLL_MS = 10_000;
const BODY_FONT = "system-ui, -apple-system, 'Inter', sans-serif";

interface Props {
  initialPositions: WhalePositionSignal[];
}

export function WhaleAnalysisStream({ initialPositions }: Props) {
  const [positions, setPositions] =
    useState<WhalePositionSignal[]>(initialPositions);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/whales/live", { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as { positions: WhalePositionSignal[] };
      setPositions(data.positions);
    } catch {
      // Keep last good analysis snapshot.
    }
  }, []);

  useVisiblePoll(load, POLL_MS);

  const sorted = useMemo(
    () => [...positions].sort((a, b) => b.payload.openedAtMs - a.payload.openedAtMs),
    [positions],
  );

  return (
    <div
      className="h-full w-full overflow-hidden"
      style={{ background: BG, color: FG }}
    >
      <div className="no-scrollbar mx-auto h-full w-full max-w-3xl overflow-y-auto pb-32 lg:max-w-5xl lg:px-6 lg:pb-6">
        <header
          className="sticky top-0 z-10 border-b-2 px-5 pt-5 pb-3"
          style={{ background: BG, borderColor: FAINT, fontFamily: FONT_DISPLAY }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <Headline size={28}>{`"WHALE CHATTER"`}</Headline>
              <p className="mt-1 text-[11px]" style={{ color: DIM, fontFamily: BODY_FONT }}>
                Live analysis for whale source positions.
              </p>
            </div>
            <div
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest"
              style={{
                background: `${ACCENT}20`,
                color: ACCENT,
                border: `1px solid ${ACCENT}40`,
              }}
            >
              <span
                className="inline-block h-2 w-2 animate-pulse rounded-full"
                style={{ background: ACCENT, boxShadow: `0 0 8px ${ACCENT}` }}
              />
              LIVE
            </div>
          </div>
        </header>

        {sorted.length === 0 ? (
          <EmptyStream />
        ) : (
          <ul>
            {sorted.map((position) => (
              <AnalysisRow
                key={position.payload.positionId}
                position={position}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AnalysisRow({ position }: { position: WhalePositionSignal }) {
  const [now, setNow] = useState(0);
  const p = position.payload;
  const analysis = p.analysis;
  const sideColor = p.side === "long" ? GREEN : RED;

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <li className="px-5 py-4" style={{ borderBottom: `1px solid ${FAINT}` }}>
      <div className="flex items-start gap-3">
        <StoryAvatar
          emoji={p.displayName.slice(0, 1).toUpperCase()}
          imageUrl={p.avatarUrl}
          mood={p.stale ? "WOUNDED" : "HUNTING"}
          size={42}
          pulse={!p.stale}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0 flex-1 truncate text-[13px]" style={{ fontFamily: BODY_FONT }}>
              <span className="font-bold" style={{ color: FG }}>
                {p.displayName}
              </span>{" "}
              <span style={{ color: DIM }}>is in</span>{" "}
              <span className="rounded px-1 py-px text-[10px] font-bold uppercase" style={{ background: `${sideColor}22`, color: sideColor }}>
                {p.side}
              </span>{" "}
              <span className="font-bold" style={{ color: FG }}>
                {p.market}
              </span>{" "}
              <span style={{ color: DIM }}>{p.leverage}x</span>
            </div>
            <span className="shrink-0 text-[11px]" style={{ color: DIM, fontFamily: BODY_FONT }}>
              {fmtAge(p.openedAtMs, now)}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-widest" style={{ fontFamily: FONT_DISPLAY }}>
            <FreshnessBadge stale={p.stale} />
            <span style={{ color: DIM }}>{p.source}</span>
            <span style={{ color: DIM }}>seen {fmtAge(p.lastSeenAtMs, now)}</span>
            <span style={{ color: DIM }}>{fmtUsd(p.notionalUsd)}</span>
          </div>

          {analysis ? (
            <div className="mt-3 grid gap-2 lg:grid-cols-3">
              <TextBlock label="Summary" value={analysis.summary} />
              <TextBlock label="Thesis" value={analysis.thesis} />
              <TextBlock label="Risk" value={analysis.risk} tone="risk" />
            </div>
          ) : (
            <div className="mt-3 rounded-2xl px-3 py-3 text-[13px]" style={{ background: PANEL, border: `1px solid ${FAINT}`, color: DIM, fontFamily: BODY_FONT }}>
              No generated analysis yet for this position.
            </div>
          )}

          {analysis?.entryGapWarning ? (
            <div className="mt-2 flex gap-2 rounded-2xl px-3 py-3 text-[12px] leading-snug" style={{ background: `${ACCENT}12`, border: `1px solid ${ACCENT}45`, color: FG, fontFamily: BODY_FONT }}>
              <AlertTriangle size={15} strokeWidth={2.8} style={{ color: ACCENT }} />
              <span>{analysis.entryGapWarning}</span>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function useVisiblePoll(load: () => Promise<void>, intervalMs: number) {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        void load();
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
    <span className="rounded-full px-2 py-0.5" style={{ background: stale ? `${RED}18` : `${GREEN}18`, color: stale ? RED : GREEN, border: `1px solid ${stale ? `${RED}45` : `${GREEN}45`}` }}>
      {stale ? "STALE" : "FRESH"}
    </span>
  );
}

function TextBlock({
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
      <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: tone === "risk" ? RED : DIM, fontFamily: FONT_DISPLAY }}>
        {label}
      </div>
      <p className="mt-1 text-[13px] leading-snug" style={{ color: FG, opacity: 0.92, fontFamily: BODY_FONT }}>
        {value}
      </p>
    </div>
  );
}

function EmptyStream() {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center px-8 text-center">
      <Radio size={22} strokeWidth={2.8} style={{ color: ACCENT }} />
      <div className="mt-3" style={{ fontFamily: FONT_DISPLAY }}>
        <Headline size={26}>{`"NO WHALE CHATTER"`}</Headline>
      </div>
      <p className="mt-3 text-[12px]" style={{ color: DIM, fontFamily: BODY_FONT }}>
        Analysis will stream after open whale positions refresh.
      </p>
    </div>
  );
}

function fmtUsd(v: number): string {
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtAge(ms: number, now: number): string {
  if (now === 0) return "just now";
  const diff = Math.max(0, now - ms);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
