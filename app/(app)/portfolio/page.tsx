"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  Activity,
  Check,
  Copy,
  History,
  LogOut,
  RefreshCw,
  WalletCards,
} from "lucide-react";
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

type PortfolioTab = "wallet" | "open" | "closed";

export default function PortfolioPage() {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { totalUsd: walletStableUsd, sol: walletSol, refresh: refreshBalance } =
    useWalletBalance(wallet?.address);
  const [positions, setPositions] = useState<PortfolioPosition[] | null>(null);
  const [copyRows, setCopyRows] = useState<CopyRowData[]>([]);
  const [pacificaAccount, setPacificaAccount] =
    useState<PacificaAccountData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<PortfolioTab>("wallet");
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
        const nextPacificaAccount =
          (data.pacificaAccount as PacificaAccountData | null) ?? null;
        setPacificaAccount((current) => nextPacificaAccount ?? current);
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
  const portfolioDataReady = positions !== null;
  const portfolioBalancesReady = portfolioDataReady && walletStableUsd !== null;
  const processingFundsUsd = Math.max(
    0,
    pacificaAccount?.pendingDepositUsd ?? 0,
  );
  const pacificaPortfolioValue = pacificaEquityUsd ?? copyRowsValue;
  const availableCashUsd =
    walletStableUsd == null && pacificaAvailableUsd == null
      ? null
      : (walletStableUsd ?? 0) + (pacificaAvailableUsd ?? 0);
  const totalNetWorth =
    (walletStableUsd ?? 0) +
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

  const copyWalletAddress = useCallback(async () => {
    if (!wallet?.address) return;
    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [wallet?.address]);
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
            {formatMaybeUsd(availableCashUsd, portfolioBalancesReady)}
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
          <WithdrawButton maxUsd={walletStableUsd ?? 0} onComplete={load} />
        </div>
      </div>
    </div>
  ) : null;

  return (
    <AppShell rail={portfolioRail} railTitle="Portfolio">
      <div
        className="mx-auto flex h-full max-w-md flex-col overflow-hidden px-5 pt-4 lg:max-w-none lg:px-6 lg:pt-5"
        style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
      >
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
            <div className="flex-none">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Stamp label="NET WORTH · LIVE" />
                  <div className="mt-1">
                    <BigNum size={38}>
                      {formatMaybeUsd(totalNetWorth, portfolioBalancesReady)}
                    </BigNum>
                  </div>
                </div>
                <button
                  onClick={() => void load()}
                  disabled={loading}
                  className="rounded-xl p-3 transition active:scale-95 disabled:opacity-50"
                  style={{
                    background: PANEL,
                    color: FG,
                    border: `1px solid ${FAINT}`,
                  }}
                  aria-label="Refresh portfolio"
                >
                  <RefreshCw
                    size={17}
                    className={loading ? "animate-spin" : ""}
                  />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <PortfolioSummaryCard
                  label="Cash"
                  value={formatMaybeUsd(availableCashUsd, portfolioBalancesReady)}
                />
                <PortfolioSummaryCard
                  label="Open"
                  value={String(openHoldingCount)}
                  detail={formatMaybeUsd(positionsValue, portfolioDataReady)}
                />
                <PortfolioSummaryCard
                  label="Closed"
                  value={String(closedPositions.length)}
                  detail={
                    closedPositions.length > 0
                      ? formatSignedUsd(realizedPnl)
                      : "No exits"
                  }
                  tone={
                    closedPositions.length === 0
                      ? undefined
                      : realizedPnl >= 0
                        ? "up"
                        : "down"
                  }
                />
              </div>

              <div
                className="mt-4 grid grid-cols-3 gap-1 rounded-2xl p-1"
                style={{ background: PANEL_2, border: `1px solid ${FAINT}` }}
              >
                {(
                  [
                    ["wallet", "Wallet", 1, WalletCards],
                    ["open", "Open", openHoldingCount, Activity],
                    ["closed", "Closed", closedPositions.length, History],
                  ] as const
                ).map(([key, label, count, Icon]) => {
                  const active = activeTab === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setActiveTab(key)}
                      className="flex min-w-0 items-center justify-center gap-1 rounded-xl px-2 py-2 text-[10px] font-black uppercase tracking-widest transition active:scale-[0.97] sm:text-[11px]"
                      style={{
                        background: active ? ACCENT : "transparent",
                        color: active ? BG : FG,
                        opacity: active ? 1 : 0.58,
                      }}
                    >
                      <Icon size={14} strokeWidth={2.8} />
                      <span className="truncate">
                        {label} {key === "wallet" ? "" : `· ${count}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pb-24 lg:pb-6">
              <div className="flex flex-col gap-3">
                {error && (
                  <div
                    className="rounded-xl px-4 py-3 text-[11px] font-black uppercase tracking-widest"
                    style={{
                      background: `${RED}20`,
                      color: RED,
                      border: `1px solid ${RED}40`,
                    }}
                  >
                    {error}
                  </div>
                )}
                {activeTab === "wallet" && (
                  <WalletTabPanel
                    walletAddress={wallet?.address ?? null}
                    walletStableUsd={walletStableUsd}
                    walletSol={walletSol}
                    pacificaAvailableUsd={pacificaAvailableUsd}
                    availableCashUsd={availableCashUsd}
                    totalNetWorth={totalNetWorth}
                    portfolioBalancesReady={portfolioBalancesReady}
                    portfolioDataReady={portfolioDataReady}
                    processingFundsUsd={processingFundsUsd}
                    copied={copied}
                    copyWalletAddress={copyWalletAddress}
                    refreshPortfolio={load}
                  />
                )}
                {activeTab === "open" && (
                  <OpenPositionsPanel
                    positions={positions}
                    openPositions={openPositions}
                    copyRows={copyRows}
                    openHoldingCount={openHoldingCount}
                    positionsValue={positionsValue}
                    positionsPnl={positionsPnl}
                    positionsPnlPct={positionsPnlPct}
                    totalCost={totalCost}
                    refreshPortfolio={load}
                  />
                )}
                {activeTab === "closed" && (
                  <ClosedPositionsPanel
                    positions={positions}
                    closedPositions={closedPositions}
                    closedCost={closedCost}
                    realizedPnl={realizedPnl}
                    realizedPnlPct={realizedPnlPct}
                    refreshPortfolio={load}
                  />
                )}
                <button
                  onClick={logout}
                  className="mt-3 flex items-center justify-center gap-2 self-center text-[10px] font-black uppercase tracking-widest transition hover:opacity-100"
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

function formatMaybeUsd(value: number | null, ready: boolean): string {
  if (!ready) return "...";
  return value == null ? "-" : `$${value.toFixed(2)}`;
}

function formatSignedUsd(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function PortfolioSummaryCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "up" | "down";
}) {
  const toneColor = tone === "up" ? GREEN : tone === "down" ? RED : FG;

  return (
    <div
      className="min-w-0 p-3"
      style={{ background: PANEL, borderRadius: 12, border: `1px solid ${FAINT}` }}
    >
      <div
        className="truncate text-[9px] font-black uppercase tracking-widest"
        style={{ color: DIM }}
      >
        {label}
      </div>
      <div className="mt-1 truncate text-[20px] font-black leading-none" style={{ color: toneColor }}>
        {value}
      </div>
      {detail && (
        <div
          className="mt-1 truncate text-[10px] font-black uppercase tracking-widest"
          style={{ color: tone ? toneColor : DIM }}
        >
          {detail}
        </div>
      )}
    </div>
  );
}

function WalletTabPanel({
  walletAddress,
  walletStableUsd,
  walletSol,
  pacificaAvailableUsd,
  availableCashUsd,
  totalNetWorth,
  portfolioBalancesReady,
  portfolioDataReady,
  processingFundsUsd,
  copied,
  copyWalletAddress,
  refreshPortfolio,
}: {
  walletAddress: string | null;
  walletStableUsd: number | null;
  walletSol: number | null;
  pacificaAvailableUsd: number | null;
  availableCashUsd: number | null;
  totalNetWorth: number;
  portfolioBalancesReady: boolean;
  portfolioDataReady: boolean;
  processingFundsUsd: number;
  copied: boolean;
  copyWalletAddress: () => Promise<void>;
  refreshPortfolio: () => void | Promise<void>;
}) {
  return (
    <section className="space-y-3">
      <div
        className="p-4"
        style={{ background: PANEL, borderRadius: 14, border: `1px solid ${FAINT}` }}
      >
        <Stamp label="Wallet" />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <WalletMetric
            label="Net worth"
            value={formatMaybeUsd(totalNetWorth, portfolioBalancesReady)}
          />
          <WalletMetric
            label="Available"
            value={formatMaybeUsd(availableCashUsd, portfolioBalancesReady)}
          />
          <WalletMetric
            label="Wallet cash"
            value={formatMaybeUsd(walletStableUsd, walletStableUsd !== null)}
          />
          <WalletMetric
            label="Trading cash"
            value={formatMaybeUsd(pacificaAvailableUsd, portfolioDataReady)}
          />
        </div>
        {walletSol != null && (
          <div
            className="mt-3 text-[11px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            GAS {walletSol.toFixed(4)} SOL
          </div>
        )}
        {processingFundsUsd > 0 && (
          <div
            className="mt-2 text-[11px] font-black uppercase tracking-widest"
            style={{ color: ACCENT }}
          >
            Processing ${processingFundsUsd.toFixed(2)}
          </div>
        )}
      </div>

      <div
        className="p-4"
        style={{ background: PANEL, borderRadius: 14, border: `1px solid ${FAINT}` }}
      >
        <div
          className="text-[10px] font-black uppercase tracking-widest"
          style={{ color: DIM }}
        >
          Wallet address
        </div>
        <div
          className="mt-2 break-all font-mono text-[13px] font-black uppercase leading-relaxed tracking-widest"
          style={{ color: walletAddress ? FG : DIM }}
        >
          {walletAddress ?? "Wallet not ready"}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 [&>button]:min-h-12 [&>button]:rounded-xl [&>button]:text-[12px] [&>button]:font-black">
          <button
            onClick={() => void copyWalletAddress()}
            disabled={!walletAddress}
            aria-label="COPY ADDRESS"
            className="flex items-center justify-center gap-1 border border-white/10 bg-white/5 px-3 py-2 text-white transition active:scale-95 disabled:opacity-40"
          >
            {copied ? (
              <>
                <Check size={14} strokeWidth={3} style={{ color: GREEN }} />
                Copied
              </>
            ) : (
              <>
                <Copy size={14} strokeWidth={2.8} />
                Copy
              </>
            )}
          </button>
          <PacificaWithdrawButton onComplete={() => void refreshPortfolio()} />
          <WithdrawButton
            maxUsd={walletStableUsd ?? 0}
            onComplete={() => void refreshPortfolio()}
          />
        </div>
      </div>
    </section>
  );
}

function WalletMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] p-3">
      <div
        className="text-[9px] font-black uppercase tracking-widest"
        style={{ color: DIM }}
      >
        {label}
      </div>
      <div className="mt-1 text-[19px] font-black leading-none">{value}</div>
    </div>
  );
}

function OpenPositionsPanel({
  positions,
  openPositions,
  copyRows,
  openHoldingCount,
  positionsValue,
  positionsPnl,
  positionsPnlPct,
  totalCost,
  refreshPortfolio,
}: {
  positions: PortfolioPosition[] | null;
  openPositions: PortfolioPosition[];
  copyRows: CopyRowData[];
  openHoldingCount: number;
  positionsValue: number;
  positionsPnl: number;
  positionsPnlPct: number;
  totalCost: number;
  refreshPortfolio: () => void | Promise<void>;
}) {
  const hasPositions = openPositions.length > 0 || copyRows.length > 0;

  return (
    <section className="space-y-3">
      <PositionSummaryPanel
        label="Open positions"
        count={openHoldingCount}
        value={formatMaybeUsd(positionsValue, positions !== null)}
        pnl={positionsPnl}
        pnlPct={positionsPnlPct}
        cost={totalCost}
      />
      {positions === null && <PortfolioEmptyState text="LOADING POSITIONS..." />}
      {positions !== null && !hasPositions && (
        <PortfolioEmptyState
          headline={`"NO OPEN POSITIONS"`}
          text="TAP A BOT IN THE FEED TO TAIL ONE."
        />
      )}
      {copyRows.length > 0 && (
        <section className="space-y-3">
          <Stamp label="LIVE POSITIONS" value={`${copyRows.length}`} />
          {copyRows.map((row) => (
            <CopyRow
              key={row.betId ?? `${row.market}:${row.side}`}
              row={row}
              onClosed={() => void refreshPortfolio()}
            />
          ))}
        </section>
      )}
      {openPositions.length > 0 && (
        <section className="grid gap-3 lg:grid-cols-2">
          {openPositions.map((position) => (
            <PositionRow
              key={position.id}
              position={position}
              onClosed={() => void refreshPortfolio()}
              onShared={() => void refreshPortfolio()}
            />
          ))}
        </section>
      )}
    </section>
  );
}

function ClosedPositionsPanel({
  positions,
  closedPositions,
  closedCost,
  realizedPnl,
  realizedPnlPct,
  refreshPortfolio,
}: {
  positions: PortfolioPosition[] | null;
  closedPositions: PortfolioPosition[];
  closedCost: number;
  realizedPnl: number;
  realizedPnlPct: number;
  refreshPortfolio: () => void | Promise<void>;
}) {
  return (
    <section className="space-y-3">
      <PositionSummaryPanel
        label="Closed positions"
        count={closedPositions.length}
        value={formatSignedUsd(realizedPnl)}
        pnl={realizedPnl}
        pnlPct={realizedPnlPct}
        cost={closedCost}
      />
      {positions === null && <PortfolioEmptyState text="LOADING POSITIONS..." />}
      {positions !== null && closedPositions.length === 0 && (
        <PortfolioEmptyState
          headline={`"NO CLOSED YET"`}
          text="CLOSED BETS SHOW UP HERE."
        />
      )}
      {closedPositions.length > 0 && (
        <section className="grid gap-3 lg:grid-cols-2">
          {closedPositions.map((position) => (
            <PositionRow
              key={position.id}
              position={position}
              onClosed={() => void refreshPortfolio()}
              onShared={() => void refreshPortfolio()}
            />
          ))}
        </section>
      )}
    </section>
  );
}

function PositionSummaryPanel({
  label,
  count,
  value,
  pnl,
  pnlPct,
  cost,
}: {
  label: string;
  count: number;
  value: string;
  pnl: number;
  pnlPct: number;
  cost: number;
}) {
  const pnlTone = pnl >= 0 ? GREEN : RED;

  return (
    <div
      className="p-4"
      style={{ background: PANEL, borderRadius: 14, border: `1px solid ${FAINT}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <Stamp label={label} value={`${count}`} />
          <div className="mt-2 text-[30px] font-black leading-none">{value}</div>
        </div>
        <div className="rounded-xl bg-white/[0.04] px-3 py-2 text-right">
          <div
            className="text-[9px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            P/L
          </div>
          <div className="mt-1 text-[16px] font-black" style={{ color: pnlTone }}>
            {formatSignedUsd(pnl)}
          </div>
          {cost > 0 && (
            <div
              className="text-[11px] font-black"
              style={{ color: pnlTone }}
            >
              {pnlPct >= 0 ? "+" : ""}
              {pnlPct.toFixed(1)}%
            </div>
          )}
        </div>
      </div>
      <div
        className="mt-3 text-[10px] font-black uppercase tracking-widest"
        style={{ color: DIM }}
      >
        Cost ${cost.toFixed(2)}
      </div>
    </div>
  );
}

function PortfolioEmptyState({
  headline,
  text,
}: {
  headline?: string;
  text: string;
}) {
  return (
    <div className="py-12 text-center">
      {headline && <Headline size={22}>{headline}</Headline>}
      <p
        className="mt-2 text-[10px] font-black uppercase tracking-widest"
        style={{ color: DIM }}
      >
        {text}
      </p>
    </div>
  );
}
