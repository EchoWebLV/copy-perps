"use client";

import type { MemeSignal } from "@/lib/types";
import { SignalChip } from "./SignalChip";
import { StakeButtons } from "./StakeButtons";
import { useJupiterTokenInfo } from "@/lib/feed/use-card-image";
import {
  useDexScreenerPair,
  type DexScreenerSocial,
} from "@/lib/feed/use-dexscreener-pair";
import { BookmarkButton } from "@/components/watchlist/BookmarkButton";
import { useAnalyze } from "./AnalyzeProvider";
import { useCoinFlip } from "@/lib/feed/use-coin-flip";

function fmtMarketCap(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}b`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}m`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtCompactUsd(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}b`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}m`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtAge(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "—";
  const elapsed = Date.now() - ms;
  if (elapsed < 0) return "—";
  const min = elapsed / 60_000;
  if (min < 60) return `${Math.max(1, Math.round(min))}m`;
  const hr = min / 60;
  if (hr < 24) return `${Math.round(hr)}h`;
  const days = hr / 24;
  if (days < 30) return `${Math.round(days)}d`;
  const months = days / 30;
  if (months < 12) return `${Math.round(months)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

// Pick the "primary" link of each kind. DexScreener can return multiple
// websites or socials of the same type; we just take the first.
function pickSocial(
  socials: DexScreenerSocial[],
  type: string,
): string | null {
  return socials.find((s) => s.type === type)?.url ?? null;
}

function SocialIcon({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] text-neutral-300 transition active:scale-95 hover:bg-white/10 hover:text-white"
    >
      {children}
    </a>
  );
}

function SocialsRow({ socials }: { socials: DexScreenerSocial[] }) {
  const x = pickSocial(socials, "twitter");
  const tg = pickSocial(socials, "telegram");
  const dc = pickSocial(socials, "discord");
  const site = pickSocial(socials, "website");
  if (!x && !tg && !dc && !site) return null;
  return (
    <div className="mt-3 flex items-center gap-2">
      {x ? (
        <SocialIcon href={x} label="X / Twitter">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </SocialIcon>
      ) : null}
      {tg ? (
        <SocialIcon href={tg} label="Telegram">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
          </svg>
        </SocialIcon>
      ) : null}
      {dc ? (
        <SocialIcon href={dc} label="Discord">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
          </svg>
        </SocialIcon>
      ) : null}
      {site ? (
        <SocialIcon href={site} label="Website">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20" />
          </svg>
        </SocialIcon>
      ) : null}
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-3 py-2.5">
      <div className="text-[10px] tracking-wider text-neutral-500 uppercase">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-bold">{value}</div>
    </div>
  );
}

export function MemeCard({
  signal,
  flipNonce = 0,
}: {
  signal: MemeSignal;
  flipNonce?: number;
}) {
  const { icon } = useJupiterTokenInfo(signal.tokenAddress);
  const live = useDexScreenerPair(signal.tokenAddress);
  const { open: openAnalyze } = useAnalyze();
  const botBtnRef = useCoinFlip(flipNonce);

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
          ref={botBtnRef}
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

      <div className="mt-5 grid grid-cols-3 gap-2">
        <StatCell label="Liquidity" value={fmtCompactUsd(live.liquidityUsd)} />
        <StatCell label="Vol 24h" value={fmtCompactUsd(live.volume24hUsd)} />
        <StatCell label="Age" value={fmtAge(live.pairCreatedAt)} />
      </div>

      <SocialsRow socials={live.socials} />

      <div className="mt-5 flex flex-col gap-2">
        {signal.chips.map((chip, i) => (
          <SignalChip key={i} text={chip.text} level={chip.level} />
        ))}
      </div>

      <StakeButtons signal={signal} />
    </div>
  );
}
