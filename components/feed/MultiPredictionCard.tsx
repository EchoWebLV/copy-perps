"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction } from "@privy-io/react-auth/solana";
import type {
  MultiPredictionSignal,
  MultiPredictionOutcome,
  StakeAmount,
} from "@/lib/types";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import {
  decodeBase64Tx,
  postBetWithConsolidation,
  signAndSubmitTx,
} from "@/lib/bets/post-with-consolidation";
import { SignalChip } from "./SignalChip";
import { useJupiterEventImage } from "@/lib/feed/use-card-image";
import { useAnalyze } from "./AnalyzeProvider";
import { useCountdown } from "@/lib/feed/use-countdown";

const fmtVol = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : `$${(n / 1000).toFixed(0)}k`;

interface State {
  pendingMarketId?: string;
  confirmedMarketId?: string;
  error?: string | null;
}

export function MultiPredictionCard({ signal }: { signal: MultiPredictionSignal }) {
  const [state, setState] = useState<State>({});
  const [stake, setStake] = useState<StakeAmount>(10);
  const fallbackIcon = useJupiterEventImage(
    signal.imageUrl ? undefined : signal.eventId,
  );
  const icon = signal.imageUrl ?? fallbackIcon;
  const { open: openAnalyze } = useAnalyze();
  const countdown = useCountdown(signal.resolveAt);
  const isUrgent =
    signal.resolveAt != null &&
    signal.resolveAt - Date.now() / 1000 < 86_400 &&
    signal.resolveAt - Date.now() / 1000 > 0;
  const { getAccessToken } = usePrivy();
  const { signTransaction } = useSignTransaction();
  const wallet = useEmbeddedSolanaWallet();

  function flashError(msg: string) {
    setState({ error: msg });
    setTimeout(() => setState((s) => (s.error === msg ? {} : s)), 4000);
  }

  function flashConfirmed(marketId: string) {
    setState({ confirmedMarketId: marketId });
    setTimeout(
      () => setState((s) => (s.confirmedMarketId === marketId ? {} : s)),
      2200,
    );
  }

  async function buy(outcome: MultiPredictionOutcome) {
    if (!wallet?.address) {
      flashError("Wallet not ready yet");
      return;
    }
    setState({ pendingMarketId: outcome.marketId });

    let betId: string | undefined;
    let token: string | null = null;

    try {
      token = await getAccessToken();
      if (!token) throw new Error("Not signed in");

      const data = await postBetWithConsolidation(
        "/api/bet/prediction",
        {
          signal,
          outcome: "yes",
          amountUsdc: stake,
          walletAddress: wallet.address,
          marketId: outcome.marketId,
          outcomeLabel: outcome.label,
        },
        token,
        wallet,
        signTransaction,
      );
      betId = data.betId as string;

      const txBytes = decodeBase64Tx(
        data.swapTransaction,
        "multi-prediction order tx",
      );
      const sigB58 = await signAndSubmitTx(txBytes, wallet, signTransaction);

      await fetch("/api/bet/prediction/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ betId, txHash: sigB58 }),
      });

      flashConfirmed(outcome.marketId);
    } catch (err) {
      console.error("[multi-prediction buy]", err);
      const msg = err instanceof Error ? err.message : String(err);
      flashError(msg.slice(0, 80));
      if (betId && token) {
        await fetch("/api/bet/prediction/confirm", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            betId,
            failed: true,
            failureReason: msg.slice(0, 200),
          }),
        }).catch(() => {});
      }
    } finally {
      setState((s) => ({ ...s, pendingMarketId: undefined }));
    }
  }

  return (
    <div className="relative flex h-full w-full flex-col px-5 pt-[60px] pb-24 text-white">
      <span className="absolute top-[60px] left-5 rounded-lg bg-[#2563eb] px-2.5 py-1 text-[10px] font-bold tracking-[1px] uppercase">
        Market
      </span>

      {icon ? (
        <button
          type="button"
          onClick={() => openAnalyze(signal)}
          aria-label="Ask Gwak about this market"
          className="absolute top-[56px] right-5 h-14 w-14 overflow-hidden rounded-full bg-white/5 ring-1 ring-white/10 transition active:scale-95 hover:ring-emerald-300/50"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={icon}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </button>
      ) : null}

      <div className="mt-12 pr-16 text-xl font-bold leading-tight">
        {signal.question}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
        {countdown ? (
          <span
            className={`rounded-md px-2 py-0.5 font-bold ${
              countdown === "Resolved"
                ? "bg-white/[0.06] text-neutral-400"
                : isUrgent
                  ? "bg-[#ef4444]/15 text-[#fca5a5]"
                  : "bg-white/[0.06] text-neutral-300"
            }`}
          >
            {countdown === "Resolved" ? "Resolved" : `${countdown} left`}
          </span>
        ) : (
          <span>Resolves {signal.resolveDate}</span>
        )}
        <span>·</span>
        <span>{fmtVol(signal.volume24h)} 24h vol</span>
        <span>·</span>
        <span>{signal.totalOutcomes} outcomes</span>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {signal.outcomes.map((o) => {
          const pct = Math.round(o.yesProbability * 100);
          const isPending = state.pendingMarketId === o.marketId;
          const isConfirmed = state.confirmedMarketId === o.marketId;
          return (
            <button
              key={o.marketId}
              onClick={() => buy(o)}
              disabled={!!state.pendingMarketId}
              className={`group flex items-center gap-3 rounded-xl border bg-white/[0.03] px-3 py-2.5 text-left transition active:scale-[0.99] disabled:opacity-60 ${
                isConfirmed
                  ? "border-[#22c55e] bg-[#22c55e]/15"
                  : "border-white/10 hover:bg-white/[0.06]"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="truncate text-[14px] font-semibold">
                  {o.label}
                </div>
                <div className="mt-1 h-1 w-full rounded-full bg-white/10">
                  <div
                    className="h-1 rounded-full bg-[#22c55e]"
                    style={{ width: `${Math.max(2, pct)}%` }}
                  />
                </div>
              </div>
              <div className="text-right">
                <div className="text-[16px] font-extrabold text-[#22c55e]">
                  {pct}¢
                </div>
                <div className="text-[10px] font-bold text-neutral-400">
                  {isConfirmed ? "✓" : isPending ? "…" : `Buy $${stake}`}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {signal.totalOutcomes > signal.outcomes.length && (
        <div className="mt-2 text-center text-[11px] text-neutral-600">
          + {signal.totalOutcomes - signal.outcomes.length} more outcomes
        </div>
      )}

      <div className="mt-3 flex flex-col gap-1.5">
        {signal.chips.map((c, i) => (
          <SignalChip key={i} text={c.text} level={c.level} />
        ))}
      </div>

      <div className="mt-auto pt-4">
        {state.error && (
          <div className="mb-2 truncate rounded-lg bg-red-500/15 px-3 py-2 text-center text-[11px] text-red-300">
            {state.error}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-neutral-500">Bet size:</span>
          {[5, 10, 20, 50].map((amt) => {
            const selected = stake === amt;
            return (
              <button
                key={amt}
                onClick={() => setStake(amt as StakeAmount)}
                className={`flex-1 rounded-lg px-0 py-2 text-[12px] font-bold transition active:scale-95 ${
                  selected
                    ? "bg-white text-black"
                    : "bg-white/10 text-white"
                }`}
              >
                ${amt}
              </button>
            );
          })}
        </div>
        <div className="mt-3 text-center text-[11px] text-neutral-600">
          Tap an outcome to buy YES on it · Jupiter Prediction
        </div>
      </div>
    </div>
  );
}
