"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { LogOut, RefreshCw } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import {
  PositionRow,
  type PortfolioPosition,
} from "@/components/portfolio/PositionRow";
import {
  useEmbeddedSolanaWallet,
  truncateAddress,
} from "@/lib/privy/use-solana-wallet";

export default function PortfolioPage() {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const [positions, setPositions] = useState<PortfolioPosition[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    setError(null);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [authenticated, getAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalCost =
    positions?.reduce((sum, p) => sum + p.amountUsdc, 0) ?? 0;
  const totalValue =
    positions?.reduce(
      (sum, p) =>
        sum +
        (p.status === "closed"
          ? (p.proceedsUsdc ?? 0)
          : (p.currentValueUsdc ?? p.amountUsdc)),
      0,
    ) ?? 0;
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-12 pb-28">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">Portfolio</h1>
        {authenticated && (
          <button
            onClick={load}
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
        <>
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[10px] tracking-wider text-neutral-500 uppercase">
                  Total value
                </div>
                <div className="mt-1 text-3xl font-extrabold">
                  ${totalValue.toFixed(2)}
                </div>
              </div>
              <div className="text-right">
                <div
                  className={`text-base font-bold ${
                    totalPnl >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"
                  }`}
                >
                  {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
                </div>
                <div
                  className={`text-xs font-semibold ${
                    totalPnl >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"
                  }`}
                >
                  {totalPnl >= 0 ? "+" : ""}
                  {totalPnlPct.toFixed(1)}%
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-neutral-500">
              <span className="font-mono">
                {truncateAddress(wallet?.address)}
              </span>
              <span>·</span>
              <span>{positions?.length ?? 0} positions</span>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2">
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
            {positions && positions.length === 0 && (
              <div className="py-12 text-center">
                <p className="text-sm text-neutral-400">No positions yet.</p>
                <p className="mt-1 text-xs text-neutral-600">
                  Tap a meme card in the feed to open one.
                </p>
              </div>
            )}
            {positions?.map((p) => (
              <PositionRow key={p.id} position={p} onClosed={load} />
            ))}
          </div>

          <button
            onClick={logout}
            className="mt-8 flex items-center justify-center gap-2 self-center text-xs text-neutral-500 transition hover:text-neutral-300"
          >
            <LogOut size={12} /> Log out
          </button>
        </>
      )}

      <BottomNav />
    </main>
  );
}
