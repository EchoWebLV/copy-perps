"use client";

// Scalp Autopilot panel (Phase 3c). Self-contained: owns its session
// polling, the one-time instant-trading grant, and the distinct consent
// gate. The server loop does the trading; this panel only arms/disarms
// it and renders the budget ledger.

import { useCallback, useEffect, useState } from "react";
import { usePrivy, useSessionSigners, type User } from "@privy-io/react-auth";
import { Loader2 } from "lucide-react";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import {
  BG,
  DIM,
  FAINT,
  FG,
  GREEN,
  PANEL,
  PANEL_2,
  RED,
} from "@/components/v2/ui";

// Same env plumbing as FastPerpsGame: the Flash session signer is the
// signer the autopilot server signs with.
const PRIVY_INSTANT_SIGNER_ID =
  process.env.NEXT_PUBLIC_PRIVY_FLASH_SIGNER_ID ??
  process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID ??
  "";
const PRIVY_INSTANT_POLICY_IDS = (
  process.env.NEXT_PUBLIC_PRIVY_FLASH_POLICY_IDS ??
  process.env.NEXT_PUBLIC_PRIVY_POLICY_IDS ??
  ""
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const PRIVY_INSTANT_TRADING_CONFIGURED = Boolean(PRIVY_INSTANT_SIGNER_ID);

const POLL_MS = 10_000;
const MIN_BUDGET = 5;
const MAX_BUDGET = 200;

type TierName = "cruise" | "sweat" | "degen";

// Honest tier copy. Liquidation distance is ~1/leverage; at 500x Flash's
// ~4bps open + ~4bps close fees burn ~40% of that 0.2% margin at entry.
const TIER_COPY: Record<
  TierName,
  { title: string; line: string; risk: string }
> = {
  cruise: {
    title: "Cruise — 50x",
    line: "Stakes 10% of budget per trade, up to 2 trades at once. TP +100% / SL -50% attached.",
    risk: "At 50x, a 2% move against you liquidates.",
  },
  sweat: {
    title: "Sweat — 150x degen",
    line: "Stakes 5% of budget, 1 trade at a time. TP +100% / SL -50% attached.",
    risk: "At 150x, a ~0.7% move against you liquidates.",
  },
  degen: {
    title: "Full Degen — 500x",
    line: "$1–$10 stakes, 1 trade at a time. TP +150% / SL -50% always attached.",
    risk: "At 500x, a 0.1% move can liquidate — fees alone burn ~40% of the survivable range at entry.",
  },
};

interface SessionDto {
  id: string;
  budgetUsd: number;
  tier: TierName;
  status: "active" | "stopped" | "exhausted" | "target";
  realizedPnlUsd: number;
  startedAt: string;
}

interface OpenBetDto {
  betId: string;
  market: string;
  side: "long" | "short";
  stakeUsdc: number;
  leverage: number;
}

interface StatsDto {
  realizedPnlUsd: number;
  closedCount: number;
  openBets: OpenBetDto[];
}

type PrivyWalletAccount = {
  type: string;
  address?: string;
  chainType?: string;
  delegated?: boolean;
  walletClientType?: string;
};

function hasServerSideSolanaWallet(
  user: User | null | undefined,
  walletAddress: string | undefined,
): boolean {
  if (!walletAddress) return false;
  return (
    user?.linkedAccounts.some((account) => {
      const walletAccount = account as PrivyWalletAccount;
      return (
        walletAccount.type === "wallet" &&
        walletAccount.address === walletAddress &&
        walletAccount.chainType === "solana" &&
        walletAccount.delegated === true &&
        walletAccount.walletClientType?.startsWith("privy")
      );
    }) ?? false
  );
}

function fmtUsd(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export function AutopilotPanel() {
  const { authenticated, getAccessToken, user } = usePrivy();
  const { addSessionSigners } = useSessionSigners();
  const wallet = useEmbeddedSolanaWallet();

  const [budgetInput, setBudgetInput] = useState("5");
  const [tier, setTier] = useState<TierName>("cruise");
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [session, setSession] = useState<SessionDto | null>(null);
  const [stats, setStats] = useState<StatsDto | null>(null);
  const [sessionSignerWalletAddress, setSessionSignerWalletAddress] = useState<
    string | null
  >(null);

  const instantTradingEnabled =
    hasServerSideSolanaWallet(user, wallet?.address) ||
    sessionSignerWalletAddress === wallet?.address;

  const loadSession = useCallback(async () => {
    if (!authenticated) return;
    try {
      const token = await getAccessToken();
      if (!token) return;
      const resp = await fetch("/api/autopilot/session", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return;
      const body = (await resp.json()) as {
        session: SessionDto | null;
        stats: StatsDto | null;
      };
      setSession(body.session ?? null);
      setStats(body.stats ?? null);
    } catch {
      // polling is best-effort
    }
  }, [authenticated, getAccessToken]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!session || session.status !== "active") return;
    const id = setInterval(() => {
      if (!document.hidden) void loadSession();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [loadSession, session]);

  const ensureInstantTrading = useCallback(async (): Promise<boolean> => {
    if (!wallet?.address) throw new Error("wallet not ready");
    if (!PRIVY_INSTANT_TRADING_CONFIGURED) return false;
    if (instantTradingEnabled) return true;
    setNotice("Approve instant trading once...");
    await addSessionSigners({
      address: wallet.address,
      signers: [
        {
          signerId: PRIVY_INSTANT_SIGNER_ID,
          policyIds: PRIVY_INSTANT_POLICY_IDS,
        },
      ],
    });
    setSessionSignerWalletAddress(wallet.address);
    return true;
  }, [addSessionSigners, instantTradingEnabled, wallet?.address]);

  const start = useCallback(async () => {
    setError(null);
    setNotice(null);
    const budgetUsd = Number(budgetInput);
    if (
      !Number.isFinite(budgetUsd) ||
      budgetUsd < MIN_BUDGET ||
      budgetUsd > MAX_BUDGET
    ) {
      setError(`Budget must be between $${MIN_BUDGET} and $${MAX_BUDGET}.`);
      return;
    }
    if (!consented) {
      setError("Tick the consent box first.");
      return;
    }
    if (!wallet?.address) {
      setError("Connect a wallet first.");
      return;
    }
    setBusy(true);
    try {
      const instant = await ensureInstantTrading();
      if (!instant) {
        setError("Instant trading is not configured — Autopilot needs it.");
        return;
      }
      const token = await getAccessToken();
      if (!token) throw new Error("not authed");
      const resp = await fetch("/api/autopilot/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ budgetUsd, tier, walletAddress: wallet.address }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.error ?? `HTTP ${resp.status}`);
      setSession(body.session ?? null);
      setStats(body.stats ?? null);
      setNotice("Autopilot armed. First trade can take a minute or two.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start Autopilot.",
      );
    } finally {
      setBusy(false);
    }
  }, [
    budgetInput,
    consented,
    ensureInstantTrading,
    getAccessToken,
    tier,
    wallet?.address,
  ]);

  const stop = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("not authed");
      const resp = await fetch("/api/autopilot/session", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.error ?? `HTTP ${resp.status}`);
      setNotice(body.message ?? "Autopilot stopped.");
      await loadSession();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not stop Autopilot.",
      );
    } finally {
      setBusy(false);
    }
  }, [getAccessToken, loadSession]);

  const active = session?.status === "active";

  return (
    <div
      className="mt-2 rounded-xl p-3"
      style={{ background: PANEL, border: `1px solid ${FAINT}` }}
    >
      <div
        className="text-[9px] font-black uppercase tracking-widest"
        style={{ color: DIM }}
      >
        Autopilot
      </div>

      {active && session ? (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <div className="text-[9px] font-black uppercase" style={{ color: DIM }}>
                Budget
              </div>
              <div className="text-[15px] font-black" style={{ color: FG }}>
                {fmtUsd(session.budgetUsd)}
              </div>
            </div>
            <div>
              <div className="text-[9px] font-black uppercase" style={{ color: DIM }}>
                Realized P/L (worst-case)
              </div>
              <div
                className="text-[15px] font-black"
                style={{
                  color:
                    (stats?.realizedPnlUsd ?? 0) >= 0 ? GREEN : RED,
                }}
              >
                {fmtUsd(stats?.realizedPnlUsd ?? session.realizedPnlUsd)}
              </div>
            </div>
          </div>
          <div
            className="mt-1 text-[10px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            {TIER_COPY[session.tier].title} · {stats?.closedCount ?? 0} closed
          </div>
          <div className="mt-0.5 text-[9px] font-bold" style={{ color: DIM }}>
            Stop-loss exits count as full stake loss until chain-verified.
          </div>
          {(stats?.openBets ?? []).map((bet) => (
            <div
              key={bet.betId}
              className="mt-1.5 flex items-center justify-between rounded-lg px-2 py-1.5 text-[11px] font-black"
              style={{ background: PANEL_2, border: `1px solid ${FAINT}` }}
            >
              <span style={{ color: bet.side === "long" ? GREEN : RED }}>
                {bet.side.toUpperCase()} {bet.market} {bet.leverage}x
              </span>
              <span style={{ color: FG }}>{fmtUsd(bet.stakeUsdc)}</span>
            </div>
          ))}
          {(stats?.openBets ?? []).length === 0 && (
            <div
              className="mt-1.5 text-[10px] font-bold"
              style={{ color: DIM }}
            >
              Scanning BTC / ETH / SOL for a 15m breakout...
            </div>
          )}
          <button
            type="button"
            onClick={() => void stop()}
            disabled={busy}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[12px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:cursor-not-allowed"
            style={{ background: RED, color: BG }}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Stop Autopilot
          </button>
          <div className="mt-1.5 text-[9px] font-bold" style={{ color: DIM }}>
            Stopping leaves open positions running with their TP/SL triggers.
          </div>
        </>
      ) : (
        <>
          {session && session.status !== "active" && (
            <div
              className="mt-1.5 text-[10px] font-black uppercase tracking-widest"
              style={{
                color:
                  session.status === "target"
                    ? GREEN
                    : session.status === "exhausted"
                      ? RED
                      : DIM,
              }}
            >
              Last session: {session.status} (
              {fmtUsd(stats?.realizedPnlUsd ?? session.realizedPnlUsd)})
            </div>
          )}
          <div className="mt-2">
            <div className="text-[9px] font-black uppercase" style={{ color: DIM }}>
              Budget (${MIN_BUDGET}–${MAX_BUDGET})
            </div>
            <input
              inputMode="decimal"
              value={budgetInput}
              onChange={(e) => {
                setBudgetInput(e.target.value);
                setError(null);
              }}
              placeholder="USDC budget"
              className="mt-1 w-full rounded-lg border bg-black/20 px-3 py-2 text-[12px] font-black text-white outline-none placeholder:text-white/30"
              style={{ borderColor: FAINT }}
            />
          </div>
          <div className="mt-2 grid gap-1.5">
            {(Object.keys(TIER_COPY) as TierName[]).map((nextTier) => {
              const isActive = tier === nextTier;
              const copy = TIER_COPY[nextTier];
              return (
                <button
                  key={nextTier}
                  type="button"
                  onClick={() => setTier(nextTier)}
                  className="rounded-lg px-2.5 py-2 text-left transition active:scale-[0.99]"
                  style={{
                    background: isActive ? PANEL_2 : "transparent",
                    border: `1px solid ${isActive ? FG : FAINT}`,
                  }}
                >
                  <div
                    className="text-[11px] font-black uppercase tracking-widest"
                    style={{ color: FG }}
                  >
                    {copy.title}
                  </div>
                  <div className="text-[10px] font-bold" style={{ color: DIM }}>
                    {copy.line}
                  </div>
                  <div className="text-[10px] font-bold" style={{ color: RED }}>
                    {copy.risk}
                  </div>
                </button>
              );
            })}
          </div>
          <label
            className="mt-2 flex cursor-pointer items-start gap-2 text-[10px] font-bold"
            style={{ color: FG }}
          >
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              This AI trades this budget from your wallet. It can lose all of
              it.
            </span>
          </label>
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy || !consented || !authenticated}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[12px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: GREEN, color: BG }}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Start Autopilot
          </button>
        </>
      )}

      {(error || notice) && (
        <div
          className="mt-2 rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest"
          style={{
            background: error ? `${RED}18` : PANEL_2,
            color: error ? RED : DIM,
            border: `1px solid ${error ? `${RED}45` : FAINT}`,
          }}
        >
          {error ?? notice}
        </div>
      )}
    </div>
  );
}
