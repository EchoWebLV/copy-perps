"use client";

import { Bookmark, X } from "lucide-react";
import type { Signal, MemeSignal, PredictionSignal, WhaleSignal } from "@/lib/types";
import { useWatchlist } from "./WatchlistProvider";

const fmtUsd = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}b`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}m`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(2)}`;
};

function MemeMeta({ signal }: { signal: MemeSignal }) {
  const change = signal.change24hPct ?? 0;
  const up = change >= 0;
  return (
    <div className="text-xs text-neutral-400">
      <span className="font-bold text-white">{signal.ticker}</span>
      <span className="mx-2">·</span>
      {fmtUsd(signal.marketCap ?? 0)} mcap
      <span className="mx-2">·</span>
      <span className={up ? "text-[#22c55e]" : "text-[#ef4444]"}>
        {up ? "+" : ""}
        {change.toFixed(1)}%
      </span>
    </div>
  );
}

function PredictionMeta({ signal }: { signal: PredictionSignal }) {
  const yes = Math.round((signal.yesProbability ?? 0) * 100);
  return (
    <div className="text-xs text-neutral-400">
      <span className="font-bold text-[#22c55e]">YES {yes}¢</span>
      <span className="mx-2">·</span>
      <span className="font-bold text-[#ef4444]">NO {100 - yes}¢</span>
      <span className="mx-2">·</span>
      Resolves {signal.resolveDate}
    </div>
  );
}

function WhaleMeta({ signal }: { signal: WhaleSignal }) {
  const isLong = signal.side === "long";
  return (
    <div className="text-xs text-neutral-400">
      <span
        className={`font-bold ${isLong ? "text-[#22c55e]" : "text-[#ef4444]"}`}
      >
        {signal.asset} {signal.leverage}× {signal.side.toUpperCase()}
      </span>
      <span className="mx-2">·</span>
      {fmtUsd(signal.size)} size
    </div>
  );
}

function metaForSignal(signal: Signal) {
  if (signal.type === "meme") return <MemeMeta signal={signal} />;
  if (signal.type === "prediction") return <PredictionMeta signal={signal} />;
  if (signal.type === "whale") return <WhaleMeta signal={signal} />;
  return null;
}

function titleForSignal(signal: Signal): string {
  if (signal.type === "meme") return signal.name;
  if (signal.type === "prediction") return signal.question;
  if (signal.type === "multiprediction") return signal.question;
  if (signal.type === "whale") return signal.walletAddress;
  return "Saved signal";
}

function badgeForSignal(signal: Signal): { label: string; bg: string } {
  if (signal.type === "meme") return { label: "COIN", bg: "#ff5e3a" };
  if (signal.type === "prediction" || signal.type === "multiprediction")
    return { label: "MARKET", bg: "#2563eb" };
  if (signal.type === "whale") return { label: "WHALE", bg: "#7c3aed" };
  return { label: "", bg: "#374151" };
}

export function WatchlistRow({
  signal,
  onOpen,
}: {
  signal: Signal;
  onOpen: (signal: Signal) => void;
}) {
  const { toggle } = useWatchlist();
  const badge = badgeForSignal(signal);

  return (
    <button
      onClick={() => onOpen(signal)}
      className="flex w-full items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3 text-left transition active:scale-[0.99] hover:bg-white/[0.05]"
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[9px] font-black tracking-[1px]"
        style={{ background: badge.bg }}
      >
        {badge.label}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-white">
          {titleForSignal(signal)}
        </div>
        <div className="mt-0.5 truncate">{metaForSignal(signal)}</div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          void toggle(signal);
        }}
        aria-label="Remove from watchlist"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 transition hover:bg-white/10 hover:text-white"
      >
        <X size={14} />
      </button>
    </button>
  );
}

export function EmptyWatchlist() {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <Bookmark size={32} className="text-neutral-600" />
      <p className="mt-4 text-sm text-neutral-400">No saved signals yet.</p>
      <p className="mt-1 text-xs text-neutral-600">
        Tap the bookmark icon on any feed card to save it here.
      </p>
    </div>
  );
}
