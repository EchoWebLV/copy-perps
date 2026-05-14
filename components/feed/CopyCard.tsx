"use client";

import { useCallback, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignMessage, useSignTransaction } from "@privy-io/react-auth/solana";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { Connection } from "@solana/web3.js";
import type { PacificaTraderSignal, StakeAmount } from "@/lib/types";

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

// Compact USD formatter so big numbers don't overflow the card.
// $498,256 -> "$498k", $52,460,750 -> "$52M", $1,151,847 -> "$1.2M".
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

export function CopyCard({ signal, isActive }: Props) {
  const { getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { signMessage } = useSignMessage();
  const { signTransaction } = useSignTransaction();
  const [busy, setBusy] = useState<StakeAmount | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const pos = signal.position;
  const stats = signal.stats;
  const truncated = useMemo(
    () => `${signal.address.slice(0, 4)}…${signal.address.slice(-4)}`,
    [signal.address],
  );

  const onTap = useCallback(
    async (stake: StakeAmount) => {
      if (!pos || busy || !wallet) return;
      setBusy(stake);
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
      pos,
      signal.address,
      signal.id,
      signMessage,
      signTransaction,
      wallet,
    ],
  );

  const isLong = pos?.side === "long";
  const lev = pos && pos.leverage > 0 ? `${Math.round(pos.leverage)}x` : "cross";
  const allTimeUp = stats.pnlAllTimeUsdc >= 0;

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden p-5 text-white"
      data-card-type="pacifica_trader"
    >
      {/* Glow accent driven by the trader's all-time PnL direction. */}
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

      {/* Position hero */}
      <div className="relative mt-5 flex-1">
        {pos ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="text-3xl font-black tracking-tight">
                {pos.market}
              </div>
              <div
                className={`rounded-md px-2 py-0.5 text-xs font-bold uppercase ${
                  isLong
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-rose-500/20 text-rose-300"
                }`}
              >
                {pos.side}
              </div>
              <div className="rounded-md bg-white/10 px-2 py-0.5 text-xs font-bold uppercase text-white/80">
                {lev}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-white/40">
                  Size
                </div>
                <div className="font-semibold">{fmtUsd(pos.notionalUsd)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-white/40">
                  Entry
                </div>
                <div className="font-semibold">{fmtPrice(pos.entryPrice)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-white/40">
                  Equity
                </div>
                <div className="font-semibold">{fmtUsd(stats.equityUsdc)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-white/40">
                  Total OI
                </div>
                <div className="font-semibold">
                  {fmtUsd(stats.openInterestUsdc)}
                </div>
              </div>
            </div>

            {/* PnL strip */}
            <div className="mt-3 flex items-stretch gap-2 rounded-xl bg-white/5 p-2">
              {[
                { label: "1d", v: stats.pnl1dUsdc },
                { label: "7d", v: stats.pnl7dUsdc },
                { label: "30d", v: stats.pnl30dUsdc },
              ].map(({ label, v }) => (
                <div
                  key={label}
                  className="flex-1 rounded-lg px-2 py-1.5 text-center"
                >
                  <div className="text-[10px] uppercase tracking-wider text-white/40">
                    {label} pnl
                  </div>
                  <div className={`text-sm font-bold ${pnlColor(v)}`}>
                    {fmtUsd(v, { signed: true })}
                  </div>
                </div>
              ))}
            </div>

            <div className="text-[10px] uppercase tracking-wider text-white/40">
              7d vol {fmtUsd(stats.volume7dUsdc)} · 1d vol{" "}
              {fmtUsd(stats.volume1dUsdc)}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/40">
            No open position. Watching.
          </div>
        )}
      </div>

      {/* Stake row */}
      <div className="relative mt-5">
        <div className="mb-1.5 text-[10px] uppercase tracking-widest text-white/50">
          {pos ? `Copy this ${isLong ? "long" : "short"}` : "Waiting for trade"}
        </div>
        <div className="flex gap-2">
          {STAKES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={!pos || busy !== null || !isActive}
              onClick={() => onTap(s)}
              className={`flex-1 rounded-xl py-3 text-sm font-bold transition disabled:opacity-30 ${
                isLong
                  ? "bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                  : "bg-rose-500/15 text-rose-200 hover:bg-rose-500/25"
              }`}
            >
              {busy === s ? "…" : `$${s}`}
            </button>
          ))}
        </div>
        {status && (
          <div className="mt-2 text-center text-xs text-white/70">{status}</div>
        )}
      </div>
    </div>
  );
}
