"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { LogOut, RefreshCw } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import {
  PositionRow,
  type PortfolioPosition,
} from "@/components/portfolio/PositionRow";
import { WithdrawButton } from "@/components/portfolio/WithdrawButton";
import {
  useEmbeddedSolanaWallet,
  truncateAddress,
} from "@/lib/privy/use-solana-wallet";
import { useWalletBalance } from "@/lib/solana/use-usdc-balance";
import { useWatchlist } from "@/components/watchlist/WatchlistProvider";
import {
  WatchlistRow,
  EmptyWatchlist,
} from "@/components/watchlist/WatchlistRow";
import { WatchlistModal } from "@/components/watchlist/WatchlistModal";
import type { Signal } from "@/lib/types";

export default function PortfolioPage() {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { totalUsd: walletUsd, sol: walletSol, refresh: refreshBalance } =
    useWalletBalance(wallet?.address);
  const [positions, setPositions] = useState<PortfolioPosition[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"open" | "closed" | "watchlist">("open");
  const { items: watchlistItems } = useWatchlist();
  const [modalSignal, setModalSignal] = useState<Signal | null>(null);

  // `silent` = true skips the spinner + error UI flash; used by the
  // background polling loop so live updates don't feel like a manual
  // reload every 5 seconds. Manual refresh button still shows the spinner.
  const load = useCallback(
    async (silent = false) => {
      if (!authenticated) return;
      if (!silent) setLoading(true);
      if (!silent) setError(null);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Not signed in");
        const r = await fetch("/api/portfolio", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        setPositions(data.positions);
        void refreshBalance();
      } catch (e) {
        if (!silent) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [authenticated, getAccessToken, refreshBalance],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Live PnL: re-fetch every 5s while the tab is visible and the user is
  // signed in. Skips while `document.hidden` so we don't burn Jupiter
  // API quota / Flash on-chain reads when nobody's looking. Manual
  // refresh button still works the same way.
  useEffect(() => {
    if (!authenticated) return;
    const POLL_MS = 5000;
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

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        // Catch up immediately on tab refocus; then resume polling.
        void load(true);
        start();
      }
    };

    if (typeof document !== "undefined" && !document.hidden) {
      start();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [authenticated, load]);

  // Pending and failed bets don't represent a real position — exclude entirely.
  // Closed bets' proceeds are already back in the wallet, so they don't belong
  // in "In positions" either; counting them double-counts. Stats now reflect
  // only currently-held (confirmed) positions.
  const openPositions =
    positions?.filter((p) => p.status === "confirmed") ?? [];
  const closedPositions =
    positions?.filter((p) => p.status === "closed") ?? [];

  const totalCost = openPositions.reduce((sum, p) => sum + p.amountUsdc, 0);
  const positionsValue = openPositions.reduce(
    (sum, p) => sum + (p.currentValueUsdc ?? p.amountUsdc),
    0,
  );
  const positionsPnl = positionsValue - totalCost;
  const positionsPnlPct = totalCost > 0 ? (positionsPnl / totalCost) * 100 : 0;
  const totalNetWorth = positionsValue + (walletUsd ?? 0);

  // Realized PnL summary for the Closed tab.
  const closedCost = closedPositions.reduce((sum, p) => sum + p.amountUsdc, 0);
  const closedProceeds = closedPositions.reduce(
    (sum, p) => sum + (p.proceedsUsdc ?? 0),
    0,
  );
  const realizedPnl = closedProceeds - closedCost;
  const realizedPnlPct = closedCost > 0 ? (realizedPnl / closedCost) * 100 : 0;

  const visiblePositions =
    tab === "open"
      ? openPositions
      : tab === "closed"
        ? closedPositions
        : [];

  return (
    <main className="mx-auto flex h-full max-w-md flex-col overflow-hidden px-5 pt-12">
      <div className="flex flex-none items-center justify-between">
        <h1 className="text-2xl font-black">Portfolio</h1>
        {authenticated && (
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg bg-white/10 p-2 text-neutral-300 transition active:scale-95 disabled:opacity-50"
            aria-label="Refresh"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        )}
      </div>

      {!ready && (
        <p className="mt-6 text-sm text-neutral-500">Loading…</p>
      )}

      {ready && !authenticated && (
        <div className="mt-12 text-center">
          <p className="text-neutral-400">Log in to see your positions.</p>
          <button
            onClick={login}
            className="mt-6 rounded-2xl bg-white px-6 py-3 text-sm font-bold text-black"
          >
            Log in
          </button>
        </div>
      )}

      {ready && authenticated && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mt-4 flex-none rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-[10px] tracking-wider text-neutral-500 uppercase">
              Net worth
            </div>
            <div className="mt-1 text-3xl font-extrabold">
              ${totalNetWorth.toFixed(2)}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/[0.04] px-3 py-2.5">
                <div className="text-[10px] tracking-wider text-neutral-500 uppercase">
                  Available
                </div>
                <div className="mt-0.5 text-base font-bold">
                  {walletUsd == null ? "—" : `$${walletUsd.toFixed(2)}`}
                </div>
                {walletSol != null && (
                  <div className="text-[10px] text-neutral-500">
                    + {walletSol.toFixed(4)} SOL
                  </div>
                )}
              </div>
              <div className="rounded-xl bg-white/[0.04] px-3 py-2.5">
                <div className="text-[10px] tracking-wider text-neutral-500 uppercase">
                  In positions
                </div>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span className="text-base font-bold">
                    ${positionsValue.toFixed(2)}
                  </span>
                  {totalCost > 0 && (
                    <span
                      className={`text-[11px] font-semibold ${
                        positionsPnl >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"
                      }`}
                    >
                      {positionsPnl >= 0 ? "+" : ""}
                      {positionsPnlPct.toFixed(1)}%
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-neutral-500">
                  cost ${totalCost.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-neutral-500">
              <div className="flex items-center gap-2">
                <span className="font-mono">
                  {truncateAddress(wallet?.address)}
                </span>
                <span>·</span>
                <span>
                  {openPositions.length} open · {closedPositions.length} closed
                </span>
              </div>
              <WithdrawButton maxUsd={walletUsd ?? 0} onComplete={load} />
            </div>
          </div>

          <div className="mt-4 flex flex-none gap-1 rounded-full bg-white/5 p-1">
            <button
              onClick={() => setTab("open")}
              className={`flex-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                tab === "open"
                  ? "bg-white text-black"
                  : "text-neutral-400 active:scale-95"
              }`}
            >
              Open · {openPositions.length}
            </button>
            <button
              onClick={() => setTab("closed")}
              className={`flex-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                tab === "closed"
                  ? "bg-white text-black"
                  : "text-neutral-400 active:scale-95"
              }`}
            >
              Closed · {closedPositions.length}
            </button>
            <button
              onClick={() => setTab("watchlist")}
              className={`flex-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                tab === "watchlist"
                  ? "bg-white text-black"
                  : "text-neutral-400 active:scale-95"
              }`}
            >
              Watchlist · {watchlistItems.length}
            </button>
          </div>

          {tab === "closed" && closedPositions.length > 0 && (
            <div className="mt-3 flex-none rounded-xl bg-white/[0.04] px-3 py-2.5">
              <div className="text-[10px] tracking-wider text-neutral-500 uppercase">
                Realized PnL
              </div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span
                  className={`text-base font-bold ${
                    realizedPnl >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"
                  }`}
                >
                  {realizedPnl >= 0 ? "+" : ""}${realizedPnl.toFixed(2)}
                </span>
                {closedCost > 0 && (
                  <span
                    className={`text-[11px] font-semibold ${
                      realizedPnl >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"
                    }`}
                  >
                    {realizedPnlPct >= 0 ? "+" : ""}
                    {realizedPnlPct.toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="text-[10px] text-neutral-500">
                cost ${closedCost.toFixed(2)}
              </div>
            </div>
          )}

          <div className="no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-2 pb-24">
              {tab !== "watchlist" && (
                <>
                  {error && (
                    <div className="rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300">
                      {error}
                    </div>
                  )}
                  {positions === null && !error && (
                    <div className="py-12 text-center text-sm text-neutral-500">
                      Loading positions…
                    </div>
                  )}
                  {positions && visiblePositions.length === 0 && (
                    <div className="py-12 text-center">
                      <p className="text-sm text-neutral-400">
                        {tab === "open"
                          ? "No open positions."
                          : "No closed positions yet."}
                      </p>
                      <p className="mt-1 text-xs text-neutral-600">
                        {tab === "open"
                          ? "Tap a meme card in the feed to open one."
                          : "Closed bets show up here."}
                      </p>
                    </div>
                  )}
                  {visiblePositions.map((p) => (
                    <PositionRow key={p.id} position={p} onClosed={load} />
                  ))}
                </>
              )}
              {tab === "watchlist" && (
                <>
                  {watchlistItems.length === 0 ? (
                    <EmptyWatchlist />
                  ) : (
                    watchlistItems.map((item) => (
                      <WatchlistRow
                        key={item.signalId}
                        signal={item.payload}
                        onOpen={setModalSignal}
                      />
                    ))
                  )}
                </>
              )}
              <button
                onClick={logout}
                className="mt-6 flex items-center justify-center gap-2 self-center text-xs text-neutral-500 transition hover:text-neutral-300"
              >
                <LogOut size={12} /> Log out
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
      <WatchlistModal signal={modalSignal} onClose={() => setModalSignal(null)} />
    </main>
  );
}
