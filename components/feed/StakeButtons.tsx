"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction } from "@privy-io/react-auth/solana";
import type { Signal, StakeAmount } from "@/lib/types";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import {
  decodeBase64Tx,
  postBetWithConsolidation,
  signAndSubmitTx as signAndSubmit,
} from "@/lib/bets/post-with-consolidation";

interface Props {
  signal: Signal;
}

type ButtonState = { pending?: string; confirmed?: string; error?: string | null };

export function StakeButtons({ signal }: Props) {
  const [state, setState] = useState<ButtonState>({});
  const { getAccessToken, authenticated, login } = usePrivy();
  const { signTransaction } = useSignTransaction();
  const wallet = useEmbeddedSolanaWallet();

  // Anonymous users can scroll the feed but need to log in to bet. Calling
  // Privy's login() opens the auth modal; the user can return and tap the
  // stake button again once signed in.
  function requireAuth(): boolean {
    if (!authenticated) {
      login();
      return false;
    }
    return true;
  }

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
    if (!requireAuth()) return;
    if (!wallet?.address) {
      flashError("Wallet not ready yet");
      return;
    }
    const key = `buy-${amount}`;
    setState({ pending: key });

    let betId: string | undefined;
    let token: string | null = null;

    try {
      token = await getAccessToken();
      if (!token) throw new Error("Not signed in");

      const data = await postBetWithConsolidation(
        "/api/bet/meme",
        {
          signal,
          amountUsdc: amount,
          walletAddress: wallet.address,
        },
        token,
        wallet,
        signTransaction,
      );
      betId = data.betId as string;

      const txBytes = decodeBase64Tx(data.swapTransaction, "meme open tx");
      const sigB58 = await signAndSubmit(txBytes, wallet, signTransaction);

      await fetch("/api/bet/meme/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          betId,
          txHash: sigB58,
          actualOutAmount: data.expectedOutAmount,
        }),
      });

      flashConfirmed(key);
    } catch (err) {
      console.error("[meme buy]", err);
      const msg = err instanceof Error ? err.message : String(err);
      flashError(msg.slice(0, 80));

      if (betId && token) {
        await fetch("/api/bet/meme/confirm", {
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

  async function executePredictionBuy(
    outcome: "yes" | "no",
    amount: StakeAmount,
  ) {
    if (signal.type !== "prediction") return;
    if (!requireAuth()) return;
    if (!wallet?.address) {
      flashError("Wallet not ready yet");
      return;
    }
    const key = `${outcome}-${amount}`;
    setState({ pending: key });

    let betId: string | undefined;
    let token: string | null = null;

    try {
      token = await getAccessToken();
      if (!token) throw new Error("Not signed in");

      const data = await postBetWithConsolidation(
        "/api/bet/prediction",
        {
          signal,
          outcome,
          amountUsdc: amount,
          walletAddress: wallet.address,
        },
        token,
        wallet,
        signTransaction,
      );
      betId = data.betId as string;

      const txBytes = decodeBase64Tx(data.swapTransaction, "prediction order tx");
      const sigB58 = await signAndSubmit(txBytes, wallet, signTransaction);

      await fetch("/api/bet/prediction/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ betId, txHash: sigB58 }),
      });

      flashConfirmed(key);
    } catch (err) {
      console.error("[prediction buy]", err);
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
      setState((s) => ({ ...s, pending: undefined }));
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
      </div>
    );
  }

  if (signal.type === "prediction") {
    const yesPending = state.pending === "yes-10";
    const noPending = state.pending === "no-10";
    const yesConfirmed = state.confirmed === "yes-10";
    const noConfirmed = state.confirmed === "no-10";
    return (
      <div className="mt-auto pt-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => executePredictionBuy("yes", 10)}
            disabled={!!state.pending}
            className={`rounded-2xl border border-[#22c55e] bg-[#22c55e] px-0 py-3.5 text-[14px] font-bold text-black transition active:scale-[0.97] disabled:opacity-60 ${
              yesConfirmed ? "ring-4 ring-white/40" : ""
            }`}
          >
            {yesConfirmed
              ? "✓ Bought $10 YES"
              : yesPending
                ? "…"
                : "$10 YES"}
          </button>
          <button
            onClick={() => executePredictionBuy("no", 10)}
            disabled={!!state.pending}
            className={`rounded-2xl border border-[#ef4444] bg-[#ef4444] px-0 py-3.5 text-[14px] font-bold text-white transition active:scale-[0.97] disabled:opacity-60 ${
              noConfirmed ? "ring-4 ring-white/40" : ""
            }`}
          >
            {noConfirmed
              ? "✓ Bought $10 NO"
              : noPending
                ? "…"
                : "$10 NO"}
          </button>
        </div>
        <div className="mt-2 flex gap-2">
          {[5, 20, 50].map((amt) => {
            const k = `yes-${amt}`;
            const pending = state.pending === k;
            const confirmed = state.confirmed === k;
            return (
              <button
                key={amt}
                onClick={() => executePredictionBuy("yes", amt as StakeAmount)}
                disabled={!!state.pending}
                className={`flex-1 rounded-xl border border-white/5 bg-white/10 px-0 py-2.5 text-[13px] font-bold text-white transition active:scale-[0.97] disabled:opacity-60 ${
                  confirmed ? "!border-[#22c55e] !bg-[#22c55e] !text-black" : ""
                }`}
              >
                {confirmed ? "✓" : pending ? "…" : `$${amt} YES`}
              </button>
            );
          })}
        </div>
        {errorBar}
      </div>
    );
  }

  async function executePerp(action: "tail" | "fade", amount: StakeAmount) {
    if (signal.type !== "whale") return;
    if (!requireAuth()) return;
    if (!wallet?.address) {
      flashError("Wallet not ready yet");
      return;
    }
    const key = `${action}-${amount}`;
    setState({ pending: key });

    let betId: string | undefined;
    let token: string | null = null;

    try {
      token = await getAccessToken();
      if (!token) throw new Error("Not signed in");

      const data = await postBetWithConsolidation(
        "/api/bet/perp",
        {
          signal,
          action,
          amountUsdc: amount,
          walletAddress: wallet.address,
        },
        token,
        wallet,
        signTransaction,
      );
      betId = data.betId as string;

      const txBytes = decodeBase64Tx(data.swapTransaction, "perp open tx");
      const sigB58 = await signAndSubmit(txBytes, wallet, signTransaction);

      await fetch("/api/bet/perp/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ betId, txHash: sigB58 }),
      });

      flashConfirmed(key);
    } catch (err) {
      console.error("[perp]", err);
      const msg = err instanceof Error ? err.message : String(err);
      flashError(msg.slice(0, 80));
      if (betId && token) {
        await fetch("/api/bet/perp/confirm", {
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
      setState((s) => ({ ...s, pending: undefined }));
    }
  }

  // whale
  return (
    <div className="mt-auto pt-4">
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => executePerp("tail", 10)}
          disabled={!!state.pending}
          className={`rounded-2xl border border-[#22c55e] bg-[#22c55e] px-0 py-3.5 text-[14px] font-bold text-black transition active:scale-[0.97] disabled:opacity-60 ${
            state.confirmed === "tail-10" ? "ring-4 ring-white/40" : ""
          }`}
        >
          {state.confirmed === "tail-10"
            ? "✓ Tailing"
            : state.pending === "tail-10"
              ? "…"
              : "Tail $10"}
        </button>
        <button
          onClick={() => executePerp("fade", 10)}
          disabled={!!state.pending}
          className={`rounded-2xl border border-neutral-700 bg-neutral-800 px-0 py-3.5 text-[14px] font-bold text-white transition active:scale-[0.97] disabled:opacity-60 ${
            state.confirmed === "fade-10" ? "ring-4 ring-white/40" : ""
          }`}
        >
          {state.confirmed === "fade-10"
            ? "✓ Fading"
            : state.pending === "fade-10"
              ? "…"
              : "Fade $10"}
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        {[5, 20, 50].map((amt) => {
          const k = `tail-${amt}`;
          const pending = state.pending === k;
          const confirmed = state.confirmed === k;
          return (
            <button
              key={amt}
              onClick={() => executePerp("tail", amt as StakeAmount)}
              disabled={!!state.pending}
              className={`flex-1 rounded-xl border border-white/5 bg-white/10 px-0 py-2.5 text-[13px] font-bold text-white transition active:scale-[0.97] disabled:opacity-60 ${
                confirmed ? "!border-[#22c55e] !bg-[#22c55e] !text-black" : ""
              }`}
            >
              {confirmed ? "✓" : pending ? "…" : `$${amt}`}
            </button>
          );
        })}
      </div>
      {errorBar}
    </div>
  );
}
