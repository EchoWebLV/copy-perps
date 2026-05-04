"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import type { Signal, StakeAmount } from "@/lib/types";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";

interface Props {
  signal: Signal;
}

type ButtonState = { pending?: string; confirmed?: string; error?: string | null };

export function StakeButtons({ signal }: Props) {
  const [state, setState] = useState<ButtonState>({});
  const { getAccessToken } = usePrivy();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const wallet = useEmbeddedSolanaWallet();

  function flashConfirmed(key: string) {
    setState({ confirmed: key });
    setTimeout(() => setState((s) => (s.confirmed === key ? {} : s)), 2200);
  }

  function flashError(msg: string) {
    setState({ error: msg });
    setTimeout(() => setState((s) => (s.error === msg ? {} : s)), 4000);
  }

  async function executeMemeBuy(amount: StakeAmount) {
    if (signal.type !== "meme") return;
    if (!wallet?.address) {
      flashError("Wallet not ready yet");
      return;
    }
    const key = `buy-${amount}`;
    setState({ pending: key });

    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not signed in");

      const r = await fetch("/api/bet/meme", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          signalId: signal.id,
          amountUsdc: amount,
          walletAddress: wallet.address,
        }),
      });

      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }

      const { betId, swapTransaction, expectedOutAmount } = await r.json();

      const txBytes = Uint8Array.from(atob(swapTransaction), (c) =>
        c.charCodeAt(0),
      );

      const result = await signAndSendTransaction({
        transaction: txBytes,
        wallet,
      });

      const sigB58 = bs58.encode(result.signature);

      await fetch("/api/bet/meme/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          betId,
          txHash: sigB58,
          actualOutAmount: expectedOutAmount,
        }),
      });

      flashConfirmed(key);
    } catch (err) {
      console.error("[meme buy]", err);
      const msg = err instanceof Error ? err.message : String(err);
      flashError(msg.slice(0, 80));

      const token = await getAccessToken().catch(() => null);
      if (token) {
        await fetch("/api/bet/meme/confirm", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            betId: undefined,
            failed: true,
            failureReason: msg.slice(0, 200),
          }),
        }).catch(() => {});
      }
    } finally {
      setState((s) => ({ ...s, pending: undefined }));
    }
  }

  function fireOptimistic(action: string, amount: StakeAmount) {
    const key = `${action}-${amount}`;
    setState({ pending: key });
    setTimeout(() => {
      flashConfirmed(key);
    }, 600);
    if (typeof window !== "undefined") {
      console.log(`[bet:${signal.type}] (optimistic)`, signal.id, action, amount);
    }
  }

  const errorBar = state.error && (
    <div className="mt-2 truncate rounded-lg bg-red-500/15 px-3 py-2 text-center text-[11px] text-red-300">
      {state.error}
    </div>
  );

  if (signal.type === "meme") {
    return (
      <div className="mt-auto pt-4">
        <div className="flex gap-2">
          {[5, 10, 20].map((amt) => {
            const key = `buy-${amt}`;
            const isConfirmed = state.confirmed === key;
            const isPending = state.pending === key;
            const isPrimary = amt === 10;
            return (
              <button
                key={amt}
                onClick={() => executeMemeBuy(amt as StakeAmount)}
                disabled={isPending || !!state.pending}
                className={`flex-1 rounded-2xl border px-0 py-3.5 text-[15px] font-bold transition active:scale-[0.97] disabled:opacity-60 ${
                  isPrimary
                    ? "border-white bg-white text-black"
                    : "border-white/5 bg-white/10 text-white"
                } ${isConfirmed ? "!border-[#22c55e] !bg-[#22c55e] !text-black" : ""}`}
              >
                {isConfirmed ? "✓ Bought" : isPending ? "…" : `$${amt}`}
              </button>
            );
          })}
        </div>
        {errorBar}
        <div className="mt-3 text-center text-[11px] text-neutral-600">
          Executes on Jupiter Swap · ↑ swipe for next
        </div>
      </div>
    );
  }

  if (signal.type === "prediction") {
    return (
      <div className="mt-auto pt-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => fireOptimistic("yes", 10)}
            className={`rounded-2xl border border-[#22c55e] bg-[#22c55e] px-0 py-3.5 text-[14px] font-bold text-black transition active:scale-[0.97] ${
              state.confirmed === "yes-10" ? "ring-4 ring-white/40" : ""
            }`}
          >
            {state.confirmed === "yes-10" ? "✓ Bought $10 YES" : "$10 YES"}
          </button>
          <button
            onClick={() => fireOptimistic("no", 10)}
            className={`rounded-2xl border border-[#ef4444] bg-[#ef4444] px-0 py-3.5 text-[14px] font-bold text-white transition active:scale-[0.97] ${
              state.confirmed === "no-10" ? "ring-4 ring-white/40" : ""
            }`}
          >
            {state.confirmed === "no-10" ? "✓ Bought $10 NO" : "$10 NO"}
          </button>
        </div>
        <div className="mt-2 flex gap-2">
          {[5, 20, 50].map((amt) => (
            <button
              key={amt}
              onClick={() => fireOptimistic("yes", amt as StakeAmount)}
              className="flex-1 rounded-xl border border-white/5 bg-white/10 px-0 py-2.5 text-[13px] font-bold text-white transition active:scale-[0.97]"
            >
              ${amt}
            </button>
          ))}
        </div>
        {errorBar}
        <div className="mt-3 text-center text-[11px] text-neutral-600">
          Executes on Jupiter Prediction · stub · ↑ swipe for next
        </div>
      </div>
    );
  }

  return (
    <div className="mt-auto pt-4">
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => fireOptimistic("tail", 10)}
          className={`rounded-2xl border border-[#22c55e] bg-[#22c55e] px-0 py-3.5 text-[14px] font-bold text-black transition active:scale-[0.97] ${
            state.confirmed === "tail-10" ? "ring-4 ring-white/40" : ""
          }`}
        >
          {state.confirmed === "tail-10" ? "✓ Tailing" : "Tail $10"}
        </button>
        <button
          onClick={() => fireOptimistic("fade", 10)}
          className={`rounded-2xl border border-neutral-700 bg-neutral-800 px-0 py-3.5 text-[14px] font-bold text-white transition active:scale-[0.97] ${
            state.confirmed === "fade-10" ? "ring-4 ring-white/40" : ""
          }`}
        >
          {state.confirmed === "fade-10" ? "✓ Fading" : "Fade $10"}
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        {[5, 20, 50].map((amt) => (
          <button
            key={amt}
            onClick={() => fireOptimistic("tail", amt as StakeAmount)}
            className="flex-1 rounded-xl border border-white/5 bg-white/10 px-0 py-2.5 text-[13px] font-bold text-white transition active:scale-[0.97]"
          >
            ${amt}
          </button>
        ))}
      </div>
      {errorBar}
      <div className="mt-3 text-center text-[11px] text-neutral-600">
        Executes on Drift Perps · stub · ↑ swipe for next
      </div>
    </div>
  );
}
