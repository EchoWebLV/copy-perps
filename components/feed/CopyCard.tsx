"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignMessage, useSignTransaction } from "@privy-io/react-auth/solana";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { Connection } from "@solana/web3.js";
import type {
  PacificaTraderSignal,
  PacificaTraderPosition,
  StakeAmount,
} from "@/lib/types";
import { useLiveMark } from "@/lib/pacifica/live-context";

const STAKES: StakeAmount[] = [5, 10, 20, 50];
const RPC =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ?? "https://api.mainnet-beta.solana.com";

interface Props {
  signal: PacificaTraderSignal;
  isActive: boolean;
}

interface OnboardResponse {
  phase: "onboard";
  alreadyOnboarded: false;
  bindMessage: string;
  bindAgentPubkey: string;
  depositTransactionB64: string;
  initialDepositUsdc: number;
}

interface OpenResponse {
  phase: "open";
  betId: string;
  fill: {
    orderId: string;
    avgFillPrice: string;
    filledAmount: string;
    side: string;
  };
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function fmtUsd(v: number, opts: { signed?: boolean } = {}): string {
  const sign = v < 0 ? "-" : opts.signed ? "+" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${sign}$${m >= 10 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    return `${sign}$${k >= 10 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  if (abs >= 1) return `${sign}$${abs.toFixed(0)}`;
  return `${sign}$${abs.toFixed(2)}`;
}

function fmtPrice(v: number): string {
  if (v >= 1000) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toPrecision(4)}`;
}

function pnlColor(v: number): string {
  if (v > 0) return "text-emerald-400";
  if (v < 0) return "text-rose-400";
  return "text-white/50";
}

function fmtAge(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function CopyCard({ signal, isActive }: Props) {
  const { getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { signMessage } = useSignMessage();
  const { signTransaction } = useSignTransaction();
  // busy is keyed by `${positionIndex}:${stake}` so each row's button
  // shows its own loading state.
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const stats = signal.stats;
  // Defensive default — stale payloads cached before the multi-position
  // refactor may still lack `positions` until the 60s feed-pool cache
  // rotates. Don't crash; show empty.
  const positions = signal.positions ?? [];
  const truncated = useMemo(
    () => `${signal.address.slice(0, 4)}…${signal.address.slice(-4)}`,
    [signal.address],
  );
  const allTimeUp = stats.pnlAllTimeUsdc >= 0;

  // Tick every 15s so "opened 4m ago" stays fresh while the user
  // dwells on a card. Cheap; no network calls.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [isActive]);

  const onTap = useCallback(
    async (positionIdx: number, stake: StakeAmount) => {
      const pos = positions[positionIdx];
      if (!pos || busy || !wallet) return;
      const key = `${positionIdx}:${stake}`;
      setBusy(key);
      setStatus("Placing order…");
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("not authed");

        const body = {
          leaderAddress: signal.address,
          market: pos.market,
          side: pos.side,
          leverage: pos.leverage,
          stakeUsdc: stake,
          signalId: signal.id,
          walletAddress: wallet.address,
        };
        let resp = await fetch("/api/bet/copy", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}));
          throw new Error(e.error ?? `HTTP ${resp.status}`);
        }
        const first = (await resp.json()) as OnboardResponse | OpenResponse;

        if (first.phase === "onboard") {
          setStatus("Authorizing trader…");
          const bindMsgBytes = new TextEncoder().encode(first.bindMessage);
          const { signature: bindSig } = (await signMessage({
            message: bindMsgBytes,
            wallet,
          })) as { signature: Uint8Array };
          const bs58 = (await import("bs58")).default;
          const bindSigB58 = bs58.encode(bindSig);
          const parsed = JSON.parse(first.bindMessage) as {
            timestamp: number;
            expiry_window: number;
          };
          const bindResp = await fetch("/api/users/me/agent/bind", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              agentPubkey: first.bindAgentPubkey,
              signatureB58: bindSigB58,
              timestamp: parsed.timestamp,
              expiryWindow: parsed.expiry_window,
              walletAddress: wallet.address,
            }),
          });
          if (!bindResp.ok) {
            const e = await bindResp.json().catch(() => ({}));
            throw new Error(`bind failed: ${e.error ?? bindResp.status}`);
          }

          setStatus("Depositing USDC…");
          const txBytes = b64ToBytes(first.depositTransactionB64);
          const { signedTransaction } = (await signTransaction({
            transaction: txBytes,
            wallet,
          })) as { signedTransaction: Uint8Array };
          const conn = new Connection(RPC, "confirmed");
          const sig = await conn.sendRawTransaction(signedTransaction, {
            maxRetries: 3,
          });
          await conn.confirmTransaction(sig, "confirmed");

          setStatus("Placing order…");
          resp = await fetch("/api/bet/copy", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
          });
          if (!resp.ok) {
            const e = await resp.json().catch(() => ({}));
            throw new Error(e.error ?? `HTTP ${resp.status}`);
          }
        }

        const open = (await resp.json()) as OpenResponse;
        setStatus(`Opened @ $${Number(open.fill.avgFillPrice).toFixed(4)}`);
      } catch (err) {
        console.error("[copy] tap failed:", err);
        setStatus(`Failed: ${String(err).slice(0, 80)}`);
      } finally {
        setBusy(null);
        setTimeout(() => setStatus(null), 5000);
      }
    },
    [
      busy,
      getAccessToken,
      positions,
      signal.address,
      signal.id,
      signMessage,
      signTransaction,
      wallet,
    ],
  );

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden px-5 pt-[76px] pb-24 text-white"
      data-card-type="pacifica_trader"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-48 opacity-40 blur-3xl"
        style={{
          background: allTimeUp
            ? "radial-gradient(60% 100% at 50% 0%, rgba(16,185,129,0.45), transparent 70%)"
            : "radial-gradient(60% 100% at 50% 0%, rgba(244,63,94,0.35), transparent 70%)",
        }}
      />

      {/* Header */}
      <div className="relative flex items-start justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">
            Pacifica Trader
          </div>
          <div className="mt-0.5 text-xl font-bold">
            {signal.username ?? truncated}
          </div>
          <a
            href={`https://app.pacifica.fi/trader/${signal.address}`}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-white/40 hover:text-white/60"
          >
            {truncated} ↗
          </a>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-white/50">
            All-time
          </div>
          <div className={`text-2xl font-bold ${pnlColor(stats.pnlAllTimeUsdc)}`}>
            {fmtUsd(stats.pnlAllTimeUsdc, { signed: true })}
          </div>
        </div>
      </div>

      {/* Stats strip */}
      <div className="relative mt-3 flex items-stretch gap-2 rounded-xl bg-white/5 p-2">
        {[
          { label: "1d", v: stats.pnl1dUsdc },
          { label: "7d", v: stats.pnl7dUsdc },
          { label: "30d", v: stats.pnl30dUsdc },
        ].map(({ label, v }) => (
          <div key={label} className="flex-1 rounded-lg px-2 py-1.5 text-center">
            <div className="text-[10px] uppercase tracking-wider text-white/40">
              {label}
            </div>
            <div className={`text-sm font-bold ${pnlColor(v)}`}>
              {fmtUsd(v, { signed: true })}
            </div>
          </div>
        ))}
      </div>

      {/* Chips row: streak + win rate */}
      {(stats.winStreak >= 3 ||
        (stats.winRatePct1d !== null && stats.totalCloses1d >= 3)) && (
        <div className="relative mt-3 flex flex-wrap gap-1.5">
          {stats.winStreak >= 3 && (
            <div className="rounded-full bg-emerald-500/20 px-2.5 py-1 text-[11px] font-bold text-emerald-200">
              🔥 {stats.winStreak} in a row
            </div>
          )}
          {stats.winRatePct1d !== null && stats.totalCloses1d >= 3 && (
            <div className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/80">
              {Math.round(stats.winRatePct1d)}% wins · {stats.totalCloses1d} trades 24h
            </div>
          )}
          <div className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/80">
            equity {fmtUsd(stats.equityUsdc)}
          </div>
        </div>
      )}

      {/* Position stack */}
      <div className="relative mt-3 flex-1 space-y-2 overflow-y-auto">
        {positions.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-white/40">
            No open positions. Watching.
          </div>
        ) : (
          positions.map((pos, idx) => (
            <PositionRow
              key={`${pos.market}:${pos.side}`}
              pos={pos}
              now={now}
              busyKey={busy}
              positionIdx={idx}
              isActive={isActive}
              onTap={onTap}
            />
          ))
        )}
      </div>

      {status && (
        <div className="relative mt-2 text-center text-xs text-white/70">
          {status}
        </div>
      )}
    </div>
  );
}

function PositionRow({
  pos,
  now,
  busyKey,
  positionIdx,
  isActive,
  onTap,
}: {
  pos: PacificaTraderPosition;
  now: number;
  busyKey: string | null;
  positionIdx: number;
  isActive: boolean;
  onTap: (positionIdx: number, stake: StakeAmount) => void;
}) {
  const isLong = pos.side === "long";
  const lev = pos.leverage > 0 ? `${pos.leverage}x` : "cross";
  const ageMs = now - pos.openedAtMs;
  const fresh = ageMs < 15 * 60 * 1000;

  // Live mark from WS trades. Compute live PnL% the same way Pacifica
  // would: (mark - entry) / entry * sideMultiplier * leverage. For
  // cross positions (leverage=0) we report price-move % instead.
  const mark = useLiveMark(pos.market);
  let livePnlPct: number | null = null;
  let livePnlLabel = "";
  if (mark && pos.entryPrice > 0) {
    const priceMovePct =
      ((mark - pos.entryPrice) / pos.entryPrice) * (isLong ? 1 : -1) * 100;
    if (pos.leverage > 0) {
      livePnlPct = priceMovePct * pos.leverage;
      livePnlLabel = "PnL";
    } else {
      livePnlPct = priceMovePct;
      livePnlLabel = "Move";
    }
  }

  return (
    <div className="rounded-2xl bg-neutral-900/60 p-3 ring-1 ring-white/10 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-lg font-black tracking-tight">{pos.market}</div>
          <div
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
              isLong
                ? "bg-emerald-500/30 text-emerald-200"
                : "bg-rose-500/30 text-rose-200"
            }`}
          >
            {pos.side}
          </div>
          <div className="rounded-md bg-white/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white/90">
            {lev}
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-white/50">
          {fresh && (
            <span
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"
              aria-hidden
            />
          )}
          {fmtAge(pos.openedAtMs, now)}
        </div>
      </div>

      <div className="mt-1.5 grid grid-cols-3 gap-x-3 text-[11px]">
        <div>
          <span className="text-white/40">Size </span>
          <span className="font-semibold">{fmtUsd(pos.notionalUsd)}</span>
        </div>
        <div>
          <span className="text-white/40">Entry </span>
          <span className="font-semibold">{fmtPrice(pos.entryPrice)}</span>
        </div>
        <div>
          {livePnlPct !== null ? (
            <>
              <span className="text-white/40">{livePnlLabel} </span>
              <span className={`font-semibold ${pnlColor(livePnlPct)}`}>
                {livePnlPct >= 0 ? "+" : ""}
                {livePnlPct.toFixed(1)}%
              </span>
            </>
          ) : (
            <span className="text-white/30">live</span>
          )}
        </div>
      </div>

      <div className="mt-2 flex gap-1.5">
        {STAKES.map((s) => {
          const key = `${positionIdx}:${s}`;
          const isBusy = busyKey === key;
          return (
            <button
              key={s}
              type="button"
              disabled={busyKey !== null}
              onClick={() => onTap(positionIdx, s)}
              className={`flex-1 rounded-lg py-2.5 text-sm font-extrabold transition active:scale-95 disabled:opacity-40 ${
                isLong
                  ? "bg-emerald-500/30 text-emerald-100 ring-1 ring-emerald-400/40 hover:bg-emerald-500/45 hover:ring-emerald-400/60"
                  : "bg-rose-500/30 text-rose-100 ring-1 ring-rose-400/40 hover:bg-rose-500/45 hover:ring-rose-400/60"
              }`}
            >
              {isBusy ? "…" : `$${s}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
