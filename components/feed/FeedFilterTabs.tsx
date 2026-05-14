"use client";

import type { Signal } from "@/lib/types";

export type FeedTab = "hot" | "fresh" | "streak" | "size";

const TABS: Array<{ id: FeedTab; label: string }> = [
  { id: "hot", label: "Hottest" },
  { id: "fresh", label: "Just opened" },
  { id: "streak", label: "On a streak" },
  { id: "size", label: "Biggest" },
];

interface Props {
  active: FeedTab;
  onChange: (tab: FeedTab) => void;
}

export function FeedFilterTabs({ active, onChange }: Props) {
  return (
    <div className="pointer-events-auto absolute inset-x-0 top-[76px] z-20 px-3">
      <div className="no-scrollbar flex justify-center gap-1.5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-bold transition ${
              active === t.id
                ? "border-white/40 bg-white/20 text-white shadow-[0_0_18px_rgba(255,255,255,0.1)]"
                : "border-white/10 bg-white/[0.06] text-white/70 hover:bg-white/[0.1]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Pure: apply a tab's filter+sort to a list of signals.
export function applyFeedTab(signals: Signal[], tab: FeedTab): Signal[] {
  switch (tab) {
    case "hot": {
      // Default order = server-provided (heatScore desc via shuffle).
      return signals;
    }
    case "fresh": {
      // Traders whose top position opened in the last 60 minutes.
      const cutoff = Date.now() - 60 * 60 * 1000;
      return signals.filter((s) => {
        if (s.type !== "pacifica_trader") return false;
        const top = s.positions?.[0];
        return top ? top.openedAtMs >= cutoff : false;
      });
    }
    case "streak": {
      // Traders with win streak >= 3.
      return signals.filter((s) => {
        if (s.type !== "pacifica_trader") return false;
        return (s.stats?.winStreak ?? 0) >= 3;
      });
    }
    case "size": {
      // Sort by max notional across positions (any rail, only
      // pacifica_trader has notional today).
      return [...signals].sort((a, b) => {
        const am =
          a.type === "pacifica_trader"
            ? Math.max(0, ...(a.positions ?? []).map((p) => p.notionalUsd))
            : 0;
        const bm =
          b.type === "pacifica_trader"
            ? Math.max(0, ...(b.positions ?? []).map((p) => p.notionalUsd))
            : 0;
        return bm - am;
      });
    }
  }
}
