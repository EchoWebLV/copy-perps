"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trophy } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { BottomNav } from "@/components/shell/BottomNav";
import { ShareCard } from "@/components/leaderboard/ShareCard";
import type { LeaderboardCard } from "@/app/api/leaderboard/route";

const POLL_MS = 10000;

export default function LeaderboardPage() {
  const [cards, setCards] = useState<LeaderboardCard[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const r = await fetch("/api/leaderboard", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setCards(data.cards);
    } catch (e) {
      if (!silent) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Live cards on the leaderboard mark-to-market against the same
  // pricing sources as the portfolio. Poll while the tab is visible
  // so PnL drifts in real time. Pauses on hidden to spare API quota.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        void load(true);
      }, POLL_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVis = () => {
      if (document.hidden) {
        stop();
      } else {
        void load(true);
        start();
      }
    };
    if (typeof document !== "undefined" && !document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  return (
    <AppShell railTitle="Wins">
      <div className="mx-auto flex h-full max-w-md flex-col overflow-hidden px-5 pt-12 lg:max-w-none lg:px-6 lg:pt-6">
        <div className="flex flex-none items-center justify-between">
          <div>
            <h1 className="text-2xl font-black">Wins</h1>
            <p className="mt-0.5 text-xs text-neutral-500">
              Live and final cards from the feed
            </p>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg bg-white/10 p-2 text-neutral-300 transition active:scale-95 disabled:opacity-50"
            aria-label="Refresh"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        <div className="no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-3 pb-24 lg:grid lg:grid-cols-2 lg:items-start lg:pb-6 xl:grid-cols-3">
            {error && (
              <div className="rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}
            {cards === null && !error && (
              <div className="py-12 text-center text-sm text-neutral-500">
                Loading leaderboard...
              </div>
            )}
            {cards && cards.length === 0 && !error && (
              <div className="py-16 text-center">
                <Trophy
                  size={32}
                  className="mx-auto text-neutral-600"
                  strokeWidth={1.5}
                />
                <p className="mt-3 text-sm text-neutral-400">
                  No shared positions yet.
                </p>
                <p className="mt-1 text-xs text-neutral-600">
                  Open a position, then tap Share in your portfolio to land here.
                </p>
              </div>
            )}
            {cards?.map((card) => <ShareCard key={card.id} card={card} />)}
          </div>
        </div>
      </div>

      <BottomNav />
    </AppShell>
  );
}
