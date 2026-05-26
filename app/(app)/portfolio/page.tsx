"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { LogOut, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
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
import { PacificaWithdrawButton } from "@/components/portfolio/PacificaWithdrawButton";
import {
  useEmbeddedSolanaWallet,
  truncateAddress,
} from "@/lib/privy/use-solana-wallet";
import { useWalletBalance } from "@/lib/solana/use-usdc-balance";
import { CopyRow, type CopyRowData } from "@/components/portfolio/CopyRow";
import { splitPortfolioPositions } from "@/lib/positions/portfolio-groups";

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const onChange = () => setMatches(mediaQuery.matches);

    onChange();
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

interface PacificaAccountData {
  balanceUsd: number | null;
  equityUsd: number | null;
  availableToSpendUsd: number | null;
  availableToWithdrawUsd: number | null;
  totalMarginUsedUsd: number | null;
  pendingDepositUsd?: number;
  pendingDeposits?: Array<{
    amountUsdc: number;
    signature: string;
    createdAt: string;
  }>;
  updatedAt: string | null;
}

export default function PortfolioPage() {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { totalUsd: walletUsd, sol: walletSol, refresh: refreshBalance } =
    useWalletBalance(wallet?.address);
  const [positions, setPositions] = useState<PortfolioPosition[] | null>(null);
  const [copyRows, setCopyRows] = useState<CopyRowData[]>([]);
  const [pacificaAccount, setPacificaAccount] =
    useState<PacificaAccountData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"open" | "closed">("open");
  const isXl = useMediaQuery("(min-width: 1280px)");

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
        setPacificaAccount(
          (data.pacificaAccount as PacificaAccountData | null) ?? null,
        );
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

  // Open copy trades render through the live copy card; closed copy trades
  // still belong in the closed ledger.
  const { openPositions, closedPositions } = splitPortfolioPositions(positions);

  const legacyPositionsValue = openPositions.reduce(
    (sum, p) => sum + (p.currentValueUsdc ?? p.amountUsdc),
    0,
  );
  const copyRowsValue = copyRows.reduce((sum, row) => {
    if (row.stakeUsdc === null) {
      const marginValue =
        row.marginUsd === null ? 0 : row.marginUsd + (row.pnlUsd ?? 0);
      return sum + Math.max(0, marginValue);
    }
    const liveMultiplier =
      row.unrealizedPnlPct === null ? 1 : 1 + row.unrealizedPnlPct / 100;
    return sum + Math.max(0, row.stakeUsdc * liveMultiplier);
  }, 0);
  const openHoldingCount = openPositions.length + copyRows.length;

  const totalCost =
    openPositions.reduce((sum, p) => sum + p.amountUsdc, 0) +
    copyRows.reduce((sum, row) => sum + (row.stakeUsdc ?? row.marginUsd ?? 0), 0);
  const positionsValue = legacyPositionsValue + copyRowsValue;
  const positionsPnl = positionsValue - totalCost;
  const positionsPnlPct = totalCost > 0 ? (positionsPnl / totalCost) * 100 : 0;
  const pacificaEquityUsd = pacificaAccount?.equityUsd ?? null;
  const pacificaAvailableUsd = pacificaAccount?.availableToSpendUsd ?? null;
  const processingFundsUsd = Math.max(
    0,
    pacificaAccount?.pendingDepositUsd ?? 0,
  );
  const pacificaPortfolioValue = pacificaEquityUsd ?? copyRowsValue;
  const availableCashUsd =
    walletUsd == null && pacificaAvailableUsd == null
      ? null
      : (walletUsd ?? 0) + (pacificaAvailableUsd ?? 0);
  const totalNetWorth =
    (walletUsd ?? 0) +
    pacificaPortfolioValue +
    legacyPositionsValue +
    processingFundsUsd;

  // Realized PnL summary for the Closed tab. Only positions with known
  // proceeds count — a closed position whose proceeds haven't been
  // recorded yet would otherwise read as a fabricated 100% loss.
  const settledClosed = closedPositions.filter((p) => p.proceedsUsdc != null);
  const closedCost = settledClosed.reduce((sum, p) => sum + p.amountUsdc, 0);
  const closedProceeds = settledClosed.reduce(
    (sum, p) => sum + (p.proceedsUsdc ?? 0),
    0,
  );
  const realizedPnl = closedProceeds - closedCost;
  const realizedPnlPct = closedCost > 0 ? (realizedPnl / closedCost) * 100 : 0;

  const visiblePositions = tab === "open" ? openPositions : closedPositions;
  const closedPnlSummary = (className: string) =>
    tab === "closed" && closedPositions.length > 0 ? (
      <div
        className={className}
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
    ) : null;
  const portfolioRail = authenticated && isXl ? (
    <div className="space-y-3">
      <div
        className="p-4"
        style={{
          background: PANEL,
          borderRadius: 16,
          border: `1px solid ${FAINT}`,
        }}
      >
        <Stamp label="Wallet" />
        <div
          className="mt-3 font-mono text-[12px] font-black uppercase tracking-widest"
          style={{ color: DIM }}
        >
          {truncateAddress(wallet?.address)}
        </div>
        <div
          className="mt-5 text-[10px] font-black uppercase tracking-widest"
          style={{ color: DIM }}
        >
          Available to trade
        </div>
        <div className="mt-1">
          <BigNum size={26}>
            {availableCashUsd == null ? "-" : `$${availableCashUsd.toFixed(2)}`}
          </BigNum>
        </div>
        {processingFundsUsd > 0 && (
          <div
            className="mt-1 text-[10px] font-black uppercase tracking-widest"
            style={{ color: ACCENT }}
          >
            Processing ${processingFundsUsd.toFixed(2)}
          </div>
        )}
      </div>

      <div
        className="p-4"
        style={{
          background: PANEL,
          borderRadius: 16,
          border: `1px solid ${FAINT}`,
        }}
      >
        <Stamp label="Actions" />
        <div className="mt-3 flex flex-col items-stretch gap-2 [&>button]:w-full">
          <PacificaWithdrawButton onComplete={load} />
          <WithdrawButton maxUsd={walletUsd ?? 0} onComplete={load} />
        </div>
      </div>
    </div>
  ) : null;

  return (
    <AppShell rail={portfolioRail} railTitle="Portfolio">
      <div
        className="mx-auto flex h-full max-w-md flex-col overflow-hidden px-5 pt-12 lg:max-w-none lg:px-6 lg:pt-6"
        style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
      >
        <div className="flex flex-none items-baseline justify-between">
          <div>
            <Headline size={30}>{`"PORTFOLIO"`}</Headline>
            <p
              className="mt-1 text-[10px] font-black uppercase tracking-[0.22em]"
              style={{ color: DIM }}
            >
              YOUR LIVE TRADES
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
          <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-rows-[auto_auto_minmax(0,1fr)]">
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

              <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                <div
                  className="p-3"
                  style={{ background: PANEL_2, borderRadius: 14 }}
                >
                  <div
                    className="text-[10px] font-black uppercase tracking-widest"
                    style={{ color: DIM }}
                  >
                    AVAILABLE TO TRADE
                  </div>
                  <div className="mt-0.5">
                    <BigNum size={18}>
                      {availableCashUsd == null
                        ? "-"
                        : `$${availableCashUsd.toFixed(2)}`}
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
                  {processingFundsUsd > 0 && (
                    <div
                      className="text-[10px] font-black uppercase tracking-widest"
                      style={{ color: ACCENT }}
                    >
                      Processing ${processingFundsUsd.toFixed(2)}
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
                <div
                  className="p-3"
                  style={{ background: PANEL_2, borderRadius: 14 }}
                >
                  <div
                    className="text-[10px] font-black uppercase tracking-widest"
                    style={{ color: DIM }}
                  >
                    OPEN
                  </div>
                  <div className="mt-0.5">
                    <BigNum size={18}>{openHoldingCount}</BigNum>
                  </div>
                </div>
                <div
                  className="p-3"
                  style={{ background: PANEL_2, borderRadius: 14 }}
                >
                  <div
                    className="text-[10px] font-black uppercase tracking-widest"
                    style={{ color: DIM }}
                  >
                    CLOSED
                  </div>
                  <div className="mt-0.5">
                    <BigNum size={18}>{closedPositions.length}</BigNum>
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
                    {openHoldingCount} OPEN · {closedPositions.length} CLOSED
                  </span>
                </div>
                {!isXl && (
                  <div className="flex items-center gap-2 xl:hidden">
                    <PacificaWithdrawButton onComplete={load} />
                    <WithdrawButton maxUsd={walletUsd ?? 0} onComplete={load} />
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-none flex-col">
              <div
                className="mt-4 flex gap-1 rounded-2xl p-1"
                style={{ background: PANEL_2, border: `1px solid ${FAINT}` }}
              >
                {(
                  [
                    ["open", "Open", openHoldingCount],
                    ["closed", "Closed", closedPositions.length],
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

              {closedPnlSummary("mt-3 flex-none p-3 lg:hidden")}
            </div>

            <div className="no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto">
              <div className="flex flex-col gap-2 pb-24 lg:grid lg:grid-cols-2 lg:items-start lg:pb-6">
                {closedPnlSummary("hidden p-3 lg:col-span-2 lg:block")}
                {error && (
                  <div
                    className="rounded-xl px-4 py-3 text-[11px] font-black uppercase tracking-widest lg:col-span-2"
                    style={{ background: `${RED}20`, color: RED, border: `1px solid ${RED}40` }}
                  >
                    {error}
                  </div>
                )}
                {positions === null && !error && (
                  <div
                    className="py-12 text-center text-[11px] font-black uppercase tracking-widest lg:col-span-2"
                    style={{ color: DIM }}
                  >
                    LOADING POSITIONS…
                  </div>
                )}
                {positions &&
                  visiblePositions.length === 0 &&
                  !(tab === "open" && copyRows.length > 0) && (
                  <div className="py-12 text-center lg:col-span-2">
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
                {tab === "open" && copyRows.length > 0 && (
                  <section className="space-y-2 lg:col-span-2">
                    <Stamp label="LIVE POSITIONS" value={`${copyRows.length}`} />
                    {copyRows.map((row) => (
                      <CopyRow
                        key={row.betId ?? `${row.market}:${row.side}`}
                        row={row}
                        onClosed={() => void load()}
                      />
                    ))}
                  </section>
                )}
                {visiblePositions.map((p) => (
                  <PositionRow
                    key={p.id}
                    position={p}
                    onClosed={load}
                    onShared={load}
                  />
                ))}
                <button
                  onClick={logout}
                  className="mt-6 flex items-center justify-center gap-2 self-center text-[10px] font-black uppercase tracking-widest transition hover:opacity-100 lg:col-span-2"
                  style={{ color: DIM }}
                >
                  <LogOut size={12} /> Log out
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <BottomNav />
    </AppShell>
  );
}
