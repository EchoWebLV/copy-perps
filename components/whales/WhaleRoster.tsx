"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Radio, Zap } from "lucide-react";
import type { WhaleTraderSignal } from "@/lib/types";
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
  StoryAvatar,
} from "@/components/v2/ui";

const POLL_MS = 4_000;

interface Props {
  initialWhales: WhaleTraderSignal[];
}

export function WhaleRoster({ initialWhales }: Props) {
  const [whales, setWhales] = useState<WhaleTraderSignal[]>(initialWhales);
  const [tailSource, setTailSource] = useState<TailSource | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/whales/roster", { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as { whales: WhaleTraderSignal[] };
      setWhales(data.whales);
    } catch {
      // Keep the last good roster if the poll misses.
    }
  }, []);

  useVisiblePoll(load, POLL_MS);

  const ranked = useMemo(
    () => [...whales].sort((a, b) => b.heatScore - a.heatScore),
    [whales],
  );

  return (
    <div
      className="relative h-full w-full overflow-hidden lg:h-dvh"
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      <BalancePill />

      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-5 pt-[72px] pb-28 lg:px-8 lg:pt-8 lg:pb-8">
        <header className="flex items-end justify-between gap-4 pb-4">
          <div>
            <Headline size={42}>{`"WHALES"`}</Headline>
            <p className="mt-1 text-[11px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              Ranked source accounts ready to copy
            </p>
          </div>
          <div
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest"
            style={{
              background: `${GREEN}18`,
              color: GREEN,
              border: `1px solid ${GREEN}40`,
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
              style={{ background: GREEN, boxShadow: `0 0 6px ${GREEN}` }}
            />
            LIVE
          </div>
        </header>

        <div className="no-scrollbar grid flex-1 auto-rows-max gap-3 overflow-y-auto lg:grid-cols-2 xl:grid-cols-3">
          {ranked.length === 0 ? (
            <EmptyRoster />
          ) : (
            ranked.map((whale, idx) => (
              <WhaleCard
                key={whale.payload.whaleId}
                whale={whale}
                rank={idx + 1}
                onTail={(source) => setTailSource(source)}
              />
            ))
          )}
        </div>
      </div>

      <TailModal
        open={!!tailSource}
        source={tailSource}
        onClose={() => setTailSource(null)}
      />
    </div>
  );
}

function WhaleCard({
  whale,
  rank,
  onTail,
}: {
  whale: WhaleTraderSignal;
  rank: number;
  onTail: (source: TailSource) => void;
}) {
  const p = whale.payload;
  const best = p.bestPosition;
  const fresh = !p.stale;
  const canTail = !!best && !best.stale;
  const side = best?.side ?? "long";
  const sideColor = side === "long" ? GREEN : RED;

  return (
    <article
      className="relative overflow-hidden"
      style={{
        background: PANEL,
        borderRadius: 22,
        border: `1px solid ${fresh ? FAINT : `${RED}55`}`,
      }}
    >
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
        <div className="flex items-center gap-3 pl-9">
          <StoryAvatar
            emoji={p.displayName.slice(0, 1).toUpperCase()}
            imageUrl={p.avatarUrl}
            mood={fresh ? "HUNTING" : "WOUNDED"}
            size={52}
            pulse={fresh && p.openPositionsCount > 0}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate">
              <Headline size={26}>{p.displayName.toUpperCase()}</Headline>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              <span>{p.source}</span>
              <span>{shortAccount(p.sourceAccount)}</span>
              <FreshnessBadge stale={p.stale} />
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-4 overflow-hidden" style={{ background: PANEL_2, borderRadius: 12, border: `1px solid ${FAINT}` }}>
          <StatCell label="OPEN" value={String(p.openPositionsCount)} color={p.openPositionsCount > 0 ? FG : DIM} />
          <StatCell label="1D" value={fmtSignedUsd(p.stats.pnl1dUsdc)} color={p.stats.pnl1dUsdc >= 0 ? GREEN : RED} />
          <StatCell label="7D" value={fmtSignedUsd(p.stats.pnl7dUsdc)} color={p.stats.pnl7dUsdc >= 0 ? GREEN : RED} />
          <StatCell label="WR" value={p.stats.winRatePct1d === null ? "N/A" : `${p.stats.winRatePct1d.toFixed(0)}%`} />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {p.tags.length > 0 ? (
            p.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider"
                style={{ background: PANEL_2, border: `1px solid ${FAINT}`, color: FG }}
              >
                {tag}
              </span>
            ))
          ) : (
            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              No tags yet
            </span>
          )}
        </div>

        {best ? (
          <div className="mt-3 rounded-2xl px-3 py-3" style={{ background: BG, border: `1px solid ${FAINT}` }}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                Best open position
              </span>
              {best.stale ? (
                <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest" style={{ color: RED }}>
                  <AlertTriangle size={11} strokeWidth={3} />
                  STALE
                </span>
              ) : null}
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-2">
                <BigNum size={28}>{best.market}</BigNum>
                <span className="rounded px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wide" style={{ background: `${sideColor}22`, color: sideColor }}>
                  {best.side}
                </span>
                <span className="text-[12px] font-black" style={{ color: DIM }}>
                  {best.leverage}x
                </span>
              </div>
              <div className="text-right text-[11px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                {fmtUsd(best.notionalUsd)}
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <MiniMetric label="Entry" value={fmtPrice(best.entryPrice)} />
              <MiniMetric
                label="Mark"
                value={best.currentMark === null ? "N/A" : fmtPrice(best.currentMark)}
              />
            </div>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded-2xl px-3 py-3 text-[11px] font-black uppercase tracking-widest" style={{ background: BG, border: `1px solid ${FAINT}`, color: DIM }}>
            <Radio size={14} strokeWidth={2.8} />
            Watching for next open position
          </div>
        )}

        <button
          type="button"
          disabled={!canTail}
          onClick={() => {
            if (!best || best.stale) return;
            onTail(toTailSource(p, best));
          }}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl py-2.5 text-[12px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:cursor-not-allowed"
          style={{
            background: canTail ? ACCENT : "rgba(250,250,242,0.08)",
            color: canTail ? BG : DIM,
            boxShadow: canTail
              ? `0 3px 0 ${ACCENT}99, inset 0 -2px 0 rgba(0,0,0,0.15)`
              : "none",
          }}
        >
          <Zap size={12} strokeWidth={3} fill={canTail ? BG : "none"} />
          {canTail ? `TAIL ${p.displayName.toUpperCase()}` : "TAIL UNAVAILABLE"}
        </button>
      </div>
    </article>
  );
}

function toTailSource(
  whale: WhaleTraderSignal["payload"],
  position: NonNullable<WhaleTraderSignal["payload"]["bestPosition"]>,
): TailSource {
  return {
    kind: "whale",
    whaleId: whale.whaleId,
    displayName: whale.displayName,
    avatarUrl: whale.avatarUrl,
    sourceAccount: whale.sourceAccount,
    sourcePositionId: position.positionId,
    asset: position.market,
    side: position.side,
    leverage: position.leverage,
    entryMark: position.entryPrice,
    currentMark: position.currentMark,
    stale: position.stale,
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
    <span style={{ color: stale ? RED : GREEN }}>
      {stale ? "STALE" : "FRESH"}
    </span>
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
    <div className="border-r px-2 py-2 text-center last:border-r-0" style={{ borderColor: FAINT }}>
      <div className="text-[8px] font-black uppercase tracking-widest" style={{ color: DIM }}>
        {label}
      </div>
      <div className="mt-0.5 text-[13px] font-black tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-2.5 py-2" style={{ background: PANEL_2, border: `1px solid ${FAINT}` }}>
      <div className="text-[8px] font-black uppercase tracking-widest" style={{ color: DIM }}>
        {label}
      </div>
      <div className="mt-0.5 text-[13px] font-black tabular-nums" style={{ color: FG }}>
        {value}
      </div>
    </div>
  );
}

function EmptyRoster() {
  return (
    <div className="col-span-full flex h-full min-h-[360px] flex-col items-center justify-center text-center">
      <Headline size={30}>{`"NO WHALES ONLINE"`}</Headline>
      <p className="mt-3 text-[12px] font-black uppercase tracking-widest" style={{ color: DIM }}>
        Waiting for source accounts to refresh
      </p>
    </div>
  );
}

function shortAccount(account: string): string {
  if (account.length <= 10) return account;
  return `${account.slice(0, 4)}...${account.slice(-4)}`;
}

function fmtUsd(v: number): string {
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtSignedUsd(v: number): string {
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(v).toFixed(0)}`;
}

function fmtPrice(v: number): string {
  if (v >= 1000) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toPrecision(4)}`;
}
