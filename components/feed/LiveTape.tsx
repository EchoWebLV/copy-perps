"use client";

import { useEffect, useState } from "react";
import { useLiveFills, type LiveFill } from "@/lib/pacifica/live-context";

function fmtUsd(v: number): string {
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    return `$${m >= 10 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (v >= 1_000) {
    const k = v / 1_000;
    return `$${k >= 10 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `$${v.toFixed(0)}`;
}

export function LiveTape() {
  const fills = useLiveFills();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  if (fills.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-12 z-20 px-3">
      <div className="no-scrollbar flex gap-1.5 overflow-x-hidden">
        {fills.map((f) => (
          <FillChip key={f.id} fill={f} now={now} />
        ))}
      </div>
    </div>
  );
}

function FillChip({ fill, now }: { fill: LiveFill; now: number }) {
  const isLong = fill.side === "bid";
  const age = Math.max(0, Math.floor((now - fill.timestampMs) / 1000));
  const ageLabel = age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`;
  return (
    <div
      className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold backdrop-blur-md ${
        isLong
          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"
          : "border-rose-500/30 bg-rose-500/15 text-rose-200"
      }`}
    >
      <span>{fill.symbol}</span>
      <span aria-hidden>{isLong ? "▲" : "▼"}</span>
      <span>{fmtUsd(fill.notional)}</span>
      <span className="text-white/40">{ageLabel}</span>
    </div>
  );
}
