"use client";

import type { PredictionSignal } from "@/lib/types";
import { SignalChip } from "./SignalChip";
import { StakeButtons } from "./StakeButtons";
import { useJupiterEventImage } from "@/lib/feed/use-card-image";
import { BookmarkButton } from "@/components/watchlist/BookmarkButton";
import { useAnalyze } from "./AnalyzeProvider";

const fmtUsd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${(n / 1_000).toFixed(0)}k`;

export function PredictionCard({ signal }: { signal: PredictionSignal }) {
  const yesCents = Math.round(signal.yesProbability * 100);
  const noCents = 100 - yesCents;
  const fallbackIcon = useJupiterEventImage(
    signal.imageUrl ? undefined : signal.eventId,
    signal.marketId,
  );
  const icon = signal.imageUrl ?? fallbackIcon;
  const { open: openAnalyze } = useAnalyze();

  return (
    <div className="relative flex h-full w-full flex-col px-5 pt-[60px] pb-24 text-white">
      <div className="absolute top-[58px] left-5 z-10 flex items-center gap-2">
        <span className="rounded-lg bg-[#2563eb] px-2.5 py-1 text-[10px] font-bold tracking-[1px] uppercase">
          Market
        </span>
        <BookmarkButton signal={signal} />
      </div>

      {icon ? (
        <button
          type="button"
          onClick={() => openAnalyze(signal)}
          aria-label="Ask Gwak about this market"
          className="absolute top-[56px] right-5 h-14 w-14 overflow-hidden rounded-full bg-white/5 ring-1 ring-white/10 transition active:scale-95 hover:ring-emerald-300/50"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={icon}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </button>
      ) : null}

      <div className="mt-14 pr-16 text-2xl font-bold leading-tight">{signal.question}</div>
      <div className="mt-3 text-xs text-neutral-500">
        Resolves {signal.resolveDate} · {fmtUsd(signal.volume24h)} volume
      </div>

      <div className="mt-6 flex gap-2.5">
        <div className="flex-1 rounded-2xl bg-white/[0.04] p-4">
          <div className="text-[11px] tracking-[1px] text-neutral-500 uppercase">YES</div>
          <div className="mt-1 text-3xl font-extrabold text-[#22c55e]">{yesCents}¢</div>
        </div>
        <div className="flex-1 rounded-2xl bg-white/[0.04] p-4">
          <div className="text-[11px] tracking-[1px] text-neutral-500 uppercase">NO</div>
          <div className="mt-1 text-3xl font-extrabold text-[#ef4444]">{noCents}¢</div>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-2">
        {signal.chips.map((chip, i) => (
          <SignalChip key={i} text={chip.text} level={chip.level} />
        ))}
      </div>

      <StakeButtons signal={signal} />
    </div>
  );
}
