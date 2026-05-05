"use client";

import type { MemeSignal } from "@/lib/types";
import { SignalChip } from "./SignalChip";
import { StakeButtons } from "./StakeButtons";
import { useJupiterTokenInfo } from "@/lib/feed/use-card-image";
import { useDexScreenerPair } from "@/lib/feed/use-dexscreener-pair";
import { BookmarkButton } from "@/components/watchlist/BookmarkButton";
import { useAnalyze } from "./AnalyzeProvider";

function fmtMarketCap(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}b`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}m`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export function MemeCard({ signal }: { signal: MemeSignal }) {
  const { icon } = useJupiterTokenInfo(signal.tokenAddress);
  const live = useDexScreenerPair(signal.tokenAddress);
  const { open: openAnalyze } = useAnalyze();

  const marketCap = live.marketCap ?? signal.marketCap;
  const change =
    live.change24hPct ??
    signal.change24hPct ??
    (signal as unknown as { change1hPct?: number }).change1hPct ??
    0;
  const sparklinePath = live.sparklinePath ?? signal.sparklinePath;
  const up = change >= 0;
  const stroke = up ? "#34d399" : "#f87171";
  const areaPath = sparklinePath ? `${sparklinePath} L 300,90 L 0,90 Z` : "";
  const gradId = `mc-area-${signal.id}`;
  const glowId = `mc-glow-${signal.id}`;

  return (
    <div className="relative flex h-full w-full flex-col px-5 pt-[60px] pb-24 text-white">
      <div className="absolute top-[58px] left-5 z-10 flex items-center gap-2">
        <span className="rounded-lg bg-[#ff5e3a] px-2.5 py-1 text-[10px] font-bold tracking-[1px] uppercase">
          Coin
        </span>
        <BookmarkButton signal={signal} />
      </div>

      {icon ? (
        <button
          type="button"
          onClick={() => openAnalyze(signal)}
          aria-label="Ask Gwak about this signal"
          className="absolute top-[56px] right-5 h-14 w-14 overflow-hidden rounded-full bg-white/5 ring-1 ring-white/10 transition active:scale-95 hover:ring-emerald-300/50"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={icon}
            alt={signal.ticker}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </button>
      ) : null}

      <div className="mt-[60px] text-[44px] font-black tracking-tight leading-none">
        {signal.ticker}
      </div>
      <div className="mt-1 text-sm text-neutral-500">{signal.name} · {signal.chain}</div>

      <div className="mt-7">
        <div className="text-[11px] font-bold uppercase tracking-[1.5px] text-neutral-500">
          Market cap
        </div>
        <div className="mt-1 text-4xl font-extrabold">
          {fmtMarketCap(marketCap)}
        </div>
        <div
          className="mt-1 text-base font-semibold"
          style={{ color: up ? "#22c55e" : "#ef4444" }}
        >
          {up ? "+" : ""}
          {change.toFixed(1)}% · 24h
        </div>
      </div>

      <div className="relative mt-5 h-[110px]">
        <svg
          viewBox="0 0 300 90"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.45" />
              <stop offset="60%" stopColor={stroke} stopOpacity="0.08" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
            <filter
              id={glowId}
              x="-10%"
              y="-30%"
              width="120%"
              height="160%"
            >
              <feGaussianBlur stdDeviation="2.4" result="b1" />
              <feGaussianBlur in="SourceGraphic" stdDeviation="0.8" result="b2" />
              <feMerge>
                <feMergeNode in="b1" />
                <feMergeNode in="b2" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {areaPath ? <path d={areaPath} fill={`url(#${gradId})`} /> : null}
          {sparklinePath ? (
            <path
              d={sparklinePath}
              fill="none"
              stroke={stroke}
              strokeOpacity="0.4"
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#${glowId})`}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {sparklinePath ? (
            <path
              d={sparklinePath}
              fill="none"
              stroke={stroke}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
      </div>

      <div className="mt-5 flex flex-col gap-2">
        {signal.chips.map((chip, i) => (
          <SignalChip key={i} text={chip.text} level={chip.level} />
        ))}
      </div>

      <StakeButtons signal={signal} />
    </div>
  );
}
