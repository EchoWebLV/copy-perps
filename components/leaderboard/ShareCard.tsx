"use client";

import { Flame, HelpCircle, Waves, Radio } from "lucide-react";
import type { LeaderboardCard } from "@/app/api/leaderboard/route";

const fmtUsd = (n: number | null | undefined) => {
  if (n == null) return "—";
  const abs = Math.abs(n);
  return `$${abs >= 1000 ? n.toFixed(0) : n.toFixed(2)}`;
};

const fmtPnl = (n: number | null | undefined) => {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "−";
  const abs = Math.abs(n);
  return `${sign}$${abs >= 1000 ? abs.toFixed(0) : abs.toFixed(2)}`;
};

const fmtPct = (n: number | null | undefined) => {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
};

function fmtTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = ms / 60_000;
  if (min < 60) return `${Math.round(min)}m ago`;
  const hr = min / 60;
  if (hr < 24) return `${Math.round(hr)}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

const RAIL_META: Record<
  string,
  { icon: typeof Flame; label: string; tint: string }
> = {
  meme: { icon: Flame, label: "Meme", tint: "text-orange-300" },
  prediction: {
    icon: HelpCircle,
    label: "Prediction",
    tint: "text-sky-300",
  },
  perp: { icon: Waves, label: "Whale", tint: "text-violet-300" },
};

export function ShareCard({ card }: { card: LeaderboardCard }) {
  const isLive = card.status === "confirmed";
  const isFinal = card.status === "closed";
  const meta = RAIL_META[card.type] ?? {
    icon: Flame,
    label: card.type,
    tint: "text-neutral-300",
  };
  const RailIcon = meta.icon;

  const title =
    card.type === "meme"
      ? (card.ticker ?? "—")
      : card.type === "prediction"
        ? (card.question ?? "—")
        : card.type === "perp"
          ? `${card.asset ?? "—"} ${card.leverage ?? 1}×`
          : card.type;

  const subtitleEl =
    card.type === "meme" && card.name ? (
      <span className="truncate text-sm text-neutral-400">{card.name}</span>
    ) : card.type === "prediction" && card.outcome ? (
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
          card.outcome === "yes"
            ? "bg-[#22c55e]/20 text-[#22c55e]"
            : "bg-[#ef4444]/20 text-[#ef4444]"
        }`}
      >
        {card.outcome.toUpperCase()}
      </span>
    ) : card.type === "perp" && card.side ? (
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
          card.side === "long"
            ? "bg-[#22c55e]/20 text-[#22c55e]"
            : "bg-[#ef4444]/20 text-[#ef4444]"
        }`}
      >
        {card.side.toUpperCase()}
        {card.notionalUsd ? ` · $${card.notionalUsd.toFixed(0)}` : ""}
      </span>
    ) : null;

  const value = isFinal ? card.proceedsUsdc : card.currentValueUsdc;
  const pnlPositive = (card.pnlUsdc ?? 0) >= 0;
  const pnlColor =
    card.pnlUsdc == null
      ? "text-neutral-400"
      : pnlPositive
        ? "text-[#22c55e]"
        : "text-[#ef4444]";
  const pnlGlow = pnlPositive
    ? "from-[#22c55e]/15 to-transparent"
    : "from-[#ef4444]/15 to-transparent";

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-5">
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b ${pnlGlow}`}
      />

      <div className="relative flex items-center justify-between">
        <div className={`flex items-center gap-2 ${meta.tint}`}>
          <RailIcon size={16} strokeWidth={2.5} />
          <span className="text-[10px] font-bold uppercase tracking-wider">
            {meta.label}
          </span>
        </div>
        {isLive ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#22c55e]/30 bg-[#22c55e]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#22c55e]">
            <Radio size={10} className="animate-pulse" />
            Live
          </span>
        ) : isFinal ? (
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            Final
          </span>
        ) : null}
      </div>

      <div className="relative mt-4">
        <div
          className="line-clamp-2 text-2xl font-black leading-tight"
          title={title}
        >
          {title}
        </div>
        {subtitleEl && (
          <div className="mt-2 flex items-center gap-2">{subtitleEl}</div>
        )}
      </div>

      <div className="relative mt-5 flex items-baseline gap-2 text-xs text-neutral-500">
        <span>Stake {fmtUsd(card.amountUsdc)}</span>
        <span>·</span>
        <span>
          {isFinal ? "Final" : "Now"} {fmtUsd(value)}
        </span>
      </div>

      <div className="relative mt-2 flex items-baseline gap-3">
        <span className={`text-4xl font-black tracking-tight ${pnlColor}`}>
          {fmtPnl(card.pnlUsdc)}
        </span>
        <span className={`text-base font-bold ${pnlColor}`}>
          {fmtPct(card.pnlPct)}
        </span>
      </div>

      <div className="relative mt-5 flex items-center justify-between border-t border-white/5 pt-3 text-[11px]">
        <span className="font-mono font-semibold text-neutral-300">
          {card.authorHandle}
        </span>
        <div className="flex items-center gap-2 text-neutral-500">
          {card.sharedAt && <span>{fmtTimeAgo(card.sharedAt)}</span>}
          <span>·</span>
          <span className="font-bold tracking-wider text-neutral-300">
            gwak.gg
          </span>
        </div>
      </div>
    </div>
  );
}
