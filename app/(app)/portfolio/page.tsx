"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { LogOut, RefreshCw } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import {
  BG,
  FG,
  ACCENT,
  GREEN,
  RED,
  DIM,
  FAINT,
  PANEL,
  PANEL_2,
  FONT_DISPLAY,
  Headline,
  BigNum,
  Stamp,
} from "@/components/v2/ui";
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
import { CopyRow, type CopyRowData } from "@/components/portfolio/CopyRow";
import type { Signal } from "@/lib/types";

export default function PortfolioPage() {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { totalUsd: walletUsd, sol: walletSol, refresh: refreshBalance } =
    useWalletBalance(wallet?.address);
  const [positions, setPositions] = useState<PortfolioPosition[] | null>(null);
  const [copyRows, setCopyRows] = useState<CopyRowData[]>([]);
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
        setCopyRows((data.copyRows as CopyRowData[]) ?? []);
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
    <main
      className="mx-auto flex h-full max-w-md flex-col overflow-hidden px-5 pt-12"
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      <div className="flex flex-none items-baseline justify-between">
        <div>
          <Headline size={30}>{`"PORTFOLIO"`}</Headline>
          <p
            className="mt-1 text-[10px] font-black uppercase tracking-[0.22em]"
            style={{ color: DIM }}
          >
            YOUR TAIL TRADES
          </p>
        </div>
        {authenticated && (
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded-xl p-2 transition active:scale-95 disabled:opacity-50"
            style={{ background: PANEL_2, color: FG, border: `1px solid ${FAINT}` }}
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
          <Headline size={26}>{`"LOG IN"`}</Headline>
          <p
            className="mt-2 text-[11px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            TO SEE YOUR POSITIONS
          </p>
          <button
            onClick={login}
            className="mt-6 rounded-2xl px-6 py-3 text-[13px] font-black uppercase tracking-widest active:scale-[0.97]"
            style={{
              background: ACCENT,
              color: BG,
              boxShadow: `0 4px 0 ${ACCENT}99, inset 0 -2px 0 rgba(0,0,0,0.15)`,
            }}
          >
            LOG IN
          </button>
        </div>
      )}

      {ready && authenticated && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className="mt-4 flex-none p-4"
            style={{
              background: PANEL,
              borderRadius: 18,
              border: `1px solid ${FAINT}`,
            }}
          >
            <Stamp label="NET WORTH · LIVE" />
            <div className="mt-1">
              <BigNum size={36}>${totalNetWorth.toFixed(2)}</BigNum>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div
                className="p-3"
                style={{ background: PANEL_2, borderRadius: 14 }}
              >
                <div
                  className="text-[10px] font-black uppercase tracking-widest"
                  style={{ color: DIM }}
                >
                  AVAILABLE
                </div>
                <div className="mt-0.5">
                  <BigNum size={18}>
                    {walletUsd == null ? "—" : `$${walletUsd.toFixed(2)}`}
                  </BigNum>
                </div>
                {walletSol != null && (
                  <div
                    className="text-[10px] font-black uppercase tracking-widest"
                    style={{ color: DIM }}
                  >
                    + {walletSol.toFixed(4)} SOL
                  </div>
                )}
              </div>
              <div
                className="p-3"
                style={{ background: PANEL_2, borderRadius: 14 }}
              >
                <div
                  className="text-[10px] font-black uppercase tracking-widest"
                  style={{ color: DIM }}
                >
                  IN POSITIONS
                </div>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <BigNum size={18}>${positionsValue.toFixed(2)}</BigNum>
                  {totalCost > 0 && (
                    <span
                      className="text-[11px] font-black tracking-widest"
                      style={{ color: positionsPnl >= 0 ? GREEN : RED }}
                    >
                      {positionsPnl >= 0 ? "+" : ""}
                      {positionsPnlPct.toFixed(1)}%
                    </span>
                  )}
                </div>
                <div
                  className="text-[10px] font-black uppercase tracking-widest"
                  style={{ color: DIM }}
                >
                  COST ${totalCost.toFixed(2)}
                </div>
              </div>
            </div>

            <div
              className="mt-3 flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-widest"
              style={{ color: DIM }}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono">
                  {truncateAddress(wallet?.address)}
                </span>
                <span>·</span>
                <span>
                  {openPositions.length} OPEN · {closedPositions.length} CLOSED
                </span>
              </div>
              <WithdrawButton maxUsd={walletUsd ?? 0} onComplete={load} />
            </div>
          </div>

          <div
            className="mt-4 flex flex-none gap-1 rounded-2xl p-1"
            style={{ background: PANEL_2, border: `1px solid ${FAINT}` }}
          >
            {(
              [
                ["open", "Open", openPositions.length],
                ["closed", "Closed", closedPositions.length],
                ["watchlist", "Watchlist", watchlistItems.length],
              ] as const
            ).map(([key, label, count]) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className="flex-1 rounded-xl px-3 py-1.5 text-[11px] font-black uppercase tracking-widest transition active:scale-[0.97]"
                  style={{
                    background: active ? ACCENT : "transparent",
                    color: active ? BG : FG,
                    opacity: active ? 1 : 0.55,
                  }}
                >
                  {label} · {count}
                </button>
              );
            })}
          </div>

          {tab === "closed" && closedPositions.length > 0 && (
            <div
              className="mt-3 flex-none p-3"
              style={{
                background: PANEL,
                borderRadius: 14,
                border: `1px solid ${FAINT}`,
              }}
            >
              <Stamp label="REALIZED P/L" />
              <div className="mt-0.5 flex items-baseline gap-2">
                <BigNum size={20} color={realizedPnl >= 0 ? GREEN : RED}>
                  {realizedPnl >= 0 ? "+" : ""}${realizedPnl.toFixed(2)}
                </BigNum>
                {closedCost > 0 && (
                  <span
                    className="text-[11px] font-black tracking-widest"
                    style={{ color: realizedPnl >= 0 ? GREEN : RED }}
                  >
                    {realizedPnlPct >= 0 ? "+" : ""}
                    {realizedPnlPct.toFixed(1)}%
                  </span>
                )}
              </div>
              <div
                className="text-[10px] font-black uppercase tracking-widest"
                style={{ color: DIM }}
              >
                COST ${closedCost.toFixed(2)}
              </div>
            </div>
          )}

          <div className="no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-2 pb-24">
              {tab !== "watchlist" && (
                <>
                  {error && (
                    <div
                      className="rounded-xl px-4 py-3 text-[11px] font-black uppercase tracking-widest"
                      style={{ background: `${RED}20`, color: RED, border: `1px solid ${RED}40` }}
                    >
                      {error}
                    </div>
                  )}
                  {positions === null && !error && (
                    <div
                      className="py-12 text-center text-[11px] font-black uppercase tracking-widest"
                      style={{ color: DIM }}
                    >
                      LOADING POSITIONS…
                    </div>
                  )}
                  {positions && visiblePositions.length === 0 && (
                    <div className="py-12 text-center">
                      <Headline size={22}>
                        {tab === "open"
                          ? `"NO OPEN POSITIONS"`
                          : `"NO CLOSED YET"`}
                      </Headline>
                      <p
                        className="mt-2 text-[10px] font-black uppercase tracking-widest"
                        style={{ color: DIM }}
                      >
                        {tab === "open"
                          ? "TAP A BOT IN THE FEED TO TAIL ONE."
                          : "CLOSED BETS SHOW UP HERE."}
                      </p>
                    </div>
                  )}
                  {visiblePositions.map((p) => (
                    <PositionRow
                      key={p.id}
                      position={p}
                      onClosed={load}
                      onShared={load}
                    />
                  ))}
                  {tab === "open" && copyRows.length > 0 && (
                    <section className="mt-4 space-y-2">
                      <Stamp label="COPIES" value={`${copyRows.length}`} />
                      {copyRows.map((row) => (
                        <CopyRow
                          key={row.betId}
                          row={row}
                          onClosed={() => void load()}
                        />
                      ))}
                    </section>
                  )}
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
                className="mt-6 flex items-center justify-center gap-2 self-center text-[10px] font-black uppercase tracking-widest transition hover:opacity-100"
                style={{ color: DIM }}
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
