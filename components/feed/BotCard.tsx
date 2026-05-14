"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { BotSignal, StakeAmount } from "@/lib/types";

const STAKES: StakeAmount[] = [5, 10, 20, 50];

interface Props {
  signal: BotSignal;
}

function pnlColor(v: number): string {
  if (v > 0) return "text-emerald-400";
  if (v < 0) return "text-rose-400";
  return "text-white/50";
}

function fmtPrice(v: number): string {
  if (v >= 1000) return `$${v.toFixed(0)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toPrecision(4)}`;
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

export function BotCard({ signal }: Props) {
  const { getAccessToken } = usePrivy();
  // busyKey = `${positionId}-${stakeAmt}` while a stake is in-flight
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const p = signal.payload;
  const positions = p.currentPositions;
  const lifetimePct = p.lifetimeReturnPct;
  const allTimeUp = p.balanceUsd >= p.startingBalanceUsd;

  async function onStake(
    positionId: string,
    asset: string,
    side: "long" | "short",
    leverage: number,
    stakeUsdc: StakeAmount,
  ) {
    const key = `${positionId}-${stakeUsdc}`;
    if (busyKey) return;
    setBusyKey(key);
    setStatus("Placing order…");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("not authed");

      const resp = await fetch("/api/bet/bot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          botId: p.botId,
          market: asset,
          side,
          leverage,
          stakeUsdc,
          signalId: signal.id,
        }),
      });

      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? `HTTP ${resp.status}`);
      }

      const data = (await resp.json()) as {
        fill?: { avgFillPrice?: string | number };
      };
      const price = data.fill?.avgFillPrice;
      setStatus(
        price
          ? `Opened ${asset} ${side} ${leverage}x @ $${Number(price).toFixed(4)}`
          : `Opened ${asset} ${side} ${leverage}x`,
      );
    } catch (err) {
      console.error("[bot] stake failed:", err);
      setStatus(`Failed: ${String(err).slice(0, 80)}`);
    } finally {
      setBusyKey(null);
      setTimeout(() => setStatus(null), 5000);
    }
  }

  const now = Date.now();

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden px-5 pt-[116px] pb-24 text-white"
      data-card-type="bot"
    >
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-48 opacity-40 blur-3xl"
        style={{
          background: allTimeUp
            ? "radial-gradient(60% 100% at 50% 0%, rgba(16,185,129,0.45), transparent 70%)"
            : "radial-gradient(60% 100% at 50% 0%, rgba(244,63,94,0.35), transparent 70%)",
        }}
      />

      {/* Header: persona + bankroll + lifetime return */}
      <div className="relative flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="text-4xl leading-none">{p.avatarEmoji}</span>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">
              Paper AI bot
            </div>
            <div className="mt-0.5 text-xl font-bold">{p.botName}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-white/50">
            Bankroll
          </div>
          <div className="text-2xl font-bold">
            ${p.balanceUsd.toFixed(0)}
          </div>
          <div className={`text-xs font-semibold ${pnlColor(lifetimePct)}`}>
            {lifetimePct >= 0 ? "+" : ""}
            {(lifetimePct * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Stats strip */}
      <div className="relative mt-3 flex items-stretch gap-2 rounded-xl bg-white/5 p-2">
        <div className="flex-1 rounded-lg px-2 py-1.5 text-center">
          <div className="text-[10px] uppercase tracking-wider text-white/40">
            Win rate
          </div>
          <div className="text-sm font-bold">
            {(p.stats.winRate * 100).toFixed(0)}%
          </div>
        </div>
        <div className="flex-1 rounded-lg px-2 py-1.5 text-center">
          <div className="text-[10px] uppercase tracking-wider text-white/40">
            24h paper
          </div>
          <div className={`text-sm font-bold ${pnlColor(p.stats.paperPnl24hUsd)}`}>
            {p.stats.paperPnl24hUsd >= 0 ? "+" : ""}$
            {Math.abs(p.stats.paperPnl24hUsd).toFixed(0)}
          </div>
        </div>
        <div className="flex-1 rounded-lg px-2 py-1.5 text-center">
          <div className="text-[10px] uppercase tracking-wider text-white/40">
            7d paper
          </div>
          <div className={`text-sm font-bold ${pnlColor(p.stats.paperPnl7dUsd)}`}>
            {p.stats.paperPnl7dUsd >= 0 ? "+" : ""}$
            {Math.abs(p.stats.paperPnl7dUsd).toFixed(0)}
          </div>
        </div>
        <div className="flex-1 rounded-lg px-2 py-1.5 text-center">
          <div className="text-[10px] uppercase tracking-wider text-white/40">
            Trades
          </div>
          <div className="text-sm font-bold">{p.stats.totalTrades}</div>
        </div>
      </div>

      {/* Positions list or idle state */}
      <div className="relative mt-3 flex-1 space-y-2 overflow-y-auto">
        {positions.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-white/40">
            <div>
              <p className="font-semibold text-white/60">Watching the tape</p>
              <p className="mt-1 text-xs">
                No active positions · ${p.freeBalanceUsd.toFixed(0)} free
              </p>
            </div>
          </div>
        ) : (
          positions.map((pos) => {
            const isLong = pos.side === "long";
            const isBusy = busyKey !== null && busyKey.startsWith(pos.positionId);
            return (
              <div
                key={pos.positionId}
                className="rounded-2xl bg-neutral-900/60 p-3 ring-1 ring-white/10 backdrop-blur-sm"
              >
                {/* Position header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="text-lg font-black tracking-tight">{pos.asset}</div>
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
                      {pos.leverage}x
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-white/50">
                    {now - pos.openSinceMs < 15 * 60 * 1000 && (
                      <span
                        className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"
                        aria-hidden
                      />
                    )}
                    {fmtAge(pos.openSinceMs, now)}
                  </div>
                </div>

                {/* Price info */}
                <div className="mt-1.5 grid grid-cols-4 gap-x-2 text-[11px]">
                  <div>
                    <span className="text-white/40">Entry </span>
                    <span className="font-semibold">{fmtPrice(pos.entryMark)}</span>
                  </div>
                  <div>
                    <span className="text-white/40">Now </span>
                    <span className="font-semibold">{fmtPrice(pos.currentMark)}</span>
                  </div>
                  <div>
                    <span className="text-white/40">PnL </span>
                    <span className={`font-semibold ${pnlColor(pos.livePaperPnlPct)}`}>
                      {pos.livePaperPnlPct >= 0 ? "+" : ""}
                      {(pos.livePaperPnlPct * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-white/40">Stake </span>
                    <span className="font-semibold">${pos.stakeUsd.toFixed(0)}</span>
                  </div>
                </div>

                {/* Per-position stake buttons */}
                <div className="mt-2 flex gap-1.5">
                  {STAKES.map((s) => {
                    const key = `${pos.positionId}-${s}`;
                    const thisIsBusy = busyKey === key;
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={busyKey !== null}
                        onClick={() =>
                          onStake(pos.positionId, pos.asset, pos.side, pos.leverage, s)
                        }
                        className={`flex-1 rounded-lg py-2.5 text-sm font-extrabold transition active:scale-95 disabled:opacity-40 ${
                          isLong
                            ? "bg-emerald-500/30 text-emerald-100 ring-1 ring-emerald-400/40 hover:bg-emerald-500/45 hover:ring-emerald-400/60"
                            : "bg-rose-500/30 text-rose-100 ring-1 ring-rose-400/40 hover:bg-rose-500/45 hover:ring-rose-400/60"
                        }`}
                      >
                        {thisIsBusy ? "…" : `$${s}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
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
