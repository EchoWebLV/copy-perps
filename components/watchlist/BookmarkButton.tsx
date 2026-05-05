"use client";

import { Bookmark } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { useWatchlist } from "./WatchlistProvider";
import type { Signal } from "@/lib/types";

export function BookmarkButton({ signal }: { signal: Signal }) {
  const { isSaved, toggle } = useWatchlist();
  const { authenticated, login } = usePrivy();
  const saved = isSaved(signal.id);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!authenticated) {
          login();
          return;
        }
        void toggle(signal);
      }}
      aria-label={saved ? "Remove from watchlist" : "Save to watchlist"}
      aria-pressed={saved}
      className={`flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur-md transition active:scale-90 ${
        saved
          ? "border-amber-300/40 bg-amber-400/15 text-amber-200"
          : "border-white/15 bg-white/[0.06] text-white/80 hover:bg-white/10"
      }`}
    >
      <Bookmark
        size={13}
        strokeWidth={2.4}
        fill={saved ? "currentColor" : "none"}
      />
    </button>
  );
}
