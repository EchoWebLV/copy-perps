"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction } from "@privy-io/react-auth/solana";
import type { Signal } from "@/lib/types";
import { CustomAmountModal } from "./CustomAmountModal";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import {
  decodeBase64Tx,
  postBetWithConsolidation,
  signAndSubmitTx as signAndSubmit,
} from "@/lib/bets/post-with-consolidation";
import { ev } from "@/lib/analytics";

interface Props {
  signal: Signal;
}

type ButtonState = { pending?: string; confirmed?: string; error?: string | null };

// Floating chip that rises out of a stake button on confirm. The
// caller renders <StakeBurst /> conditionally when confirmed === key;
// mounting it triggers the CSS rise animation in globals.css. Colors
// pick green/red to match the rail's semantics (green = bullish stake,
// red = bearish/fade).
function StakeBurst({
  label,
  tone = "win",
}: {
  label: string;
  tone?: "win" | "fade";
}) {
  return (
    <span
      className={`stake-rise pointer-events-none absolute left-1/2 -top-2 z-20 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-black tracking-wide ${
        tone === "fade"
          ? "bg-[#ef4444] text-white shadow-lg shadow-red-500/40"
          : "bg-[#22c55e] text-black shadow-lg shadow-emerald-500/40"
      }`}
    >
      {label}
    </span>
  );
}

// Per-rail input bounds for the custom-amount modal. Server validates
// these too — we mirror them client-side for instant feedback.
//   meme   — Jupiter swap accepts arbitrary > 0; floor at $1 so the
//            platform fee + slippage don't eat the trade entirely.
//   prediction / whale — hard $5 floor (Jupiter Prediction's effective
//            min after fees + Flash SDK's hard limit).
const RAIL_MIN: Record<Signal["type"], number> = {
  meme: 1,
  prediction: 5,
  multiprediction: 5,
  whale: 5,
  pacifica_trader: 5,
};
const RAIL_MAX = 1000;

export function StakeButtons({ signal }: Props) {
  const [state, setState] = useState<ButtonState>({});
  const [customAction, setCustomAction] = useState<"buy" | "tail" | null>(null);
  // Remembered between modal opens so the user doesn't retype on a
  // second custom bet within the same session.
  const [lastCustom, setLastCustom] = useState<number | undefined>(undefined);
  // Prediction-only: which stake the user has selected for an upcoming
  // YES/NO tap. The stake row above the YES/NO buttons sets this; the
  // tappable price-buttons read it to know how much to bet.
  const [predictionStake, setPredictionStake] = useState<number>(10);
  const [predictionStakeModalOpen, setPredictionStakeModalOpen] =
    useState(false);
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

  async function executeMemeBuy(amount: number) {
    if (signal.type !== "meme") return;
    ev.stakeButtonClicked("meme", {
      signal_id: signal.id,
      amount_usdc: amount,
      authenticated,
    });
    if (!requireAuth()) return;
    if (!wallet?.address) {
      flashError("Wallet not ready yet");
      return;
    }
    const key = `buy-${amount}`;
    setState({ pending: key });
    ev.betStarted("meme", { signal_id: signal.id, amount_usdc: amount });

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
      ev.betSigned("meme", {
        bet_id: betId,
        amount_usdc: amount,
        tx_hash: sigB58,
      });

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
      ev.betConfirmed("meme", {
        bet_id: betId,
        amount_usdc: amount,
        tx_hash: sigB58,
      });

      flashConfirmed(key);
    } catch (err) {
      console.error("[meme buy]", err);
      const msg = err instanceof Error ? err.message : String(err);
      flashError(msg.slice(0, 80));
      ev.betFailed("meme", {
        bet_id: betId,
        amount_usdc: amount,
        error: msg.slice(0, 200),
      });

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

  function fireOptimistic(action: string, amount: number) {
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
    amount: number,
  ) {
    if (signal.type !== "prediction") return;
    ev.stakeButtonClicked("prediction", {
      signal_id: signal.id,
      amount_usdc: amount,
      side: outcome,
      authenticated,
    });
    if (!requireAuth()) return;
    if (!wallet?.address) {
      flashError("Wallet not ready yet");
      return;
    }
    const key = `${outcome}-${amount}`;
    setState({ pending: key });
    ev.betStarted("prediction", {
      signal_id: signal.id,
      amount_usdc: amount,
      side: outcome,
    });

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
      ev.betSigned("prediction", {
        bet_id: betId,
        amount_usdc: amount,
        tx_hash: sigB58,
      });

      await fetch("/api/bet/prediction/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ betId, txHash: sigB58 }),
      });
      ev.betConfirmed("prediction", {
        bet_id: betId,
        amount_usdc: amount,
        tx_hash: sigB58,
      });

      flashConfirmed(key);
    } catch (err) {
      console.error("[prediction buy]", err);
      const msg = err instanceof Error ? err.message : String(err);
      flashError(msg.slice(0, 80));
      ev.betFailed("prediction", {
        bet_id: betId,
        amount_usdc: amount,
        error: msg.slice(0, 200),
      });

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

  // Opens the custom-amount modal for the appropriate side. Tap auths
  // the user lazily so anonymous browsers see the login prompt before
  // the modal opens (matches preset buttons' behavior).
  function openCustom(action: "buy" | "tail") {
    if (!requireAuth()) return;
    setCustomAction(action);
  }

  function handleCustomConfirm(amount: number) {
    setLastCustom(amount);
    if (customAction === "buy") void executeMemeBuy(amount);
    else if (customAction === "tail") void executePerp("tail", amount);
  }

  // Modal config per rail. The actual element renders inside each
  // signal-type branch below; this just centralizes the prop wiring.
  const customModal = (
    <CustomAmountModal
      open={customAction !== null}
      onClose={() => setCustomAction(null)}
      onConfirm={handleCustomConfirm}
      title={
        signal.type === "meme"
          ? `Buy ${(signal as { ticker?: string }).ticker ?? "token"}`
          : signal.type === "whale"
            ? `Copy ${(signal as { asset?: string }).asset ?? "position"}`
            : "Custom amount"
      }
      actionLabel={
        customAction === "buy"
          ? "Buy"
          : customAction === "tail"
            ? "Copy"
            : "Confirm"
      }
      tone="win"
      minUsd={RAIL_MIN[signal.type] ?? 5}
      maxUsd={RAIL_MAX}
      initialAmount={lastCustom}
    />
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
                onClick={() => executeMemeBuy(amt)}
                disabled={isPending || !!state.pending}
                className={`relative flex-1 rounded-2xl border px-0 py-3.5 text-[15px] font-bold transition active:scale-[0.97] disabled:opacity-60 ${
                  isPrimary
                    ? "border-white bg-white text-black"
                    : "border-white/5 bg-white/10 text-white"
                } ${isConfirmed ? "stake-confirm !border-[#22c55e] !bg-[#22c55e] !text-black" : ""}`}
              >
                {isConfirmed ? "✓ Bought" : isPending ? "…" : `$${amt}`}
                {isConfirmed && <StakeBurst label={`+$${amt}`} />}
              </button>
            );
          })}
          <button
            onClick={() => openCustom("buy")}
            disabled={!!state.pending}
            className="flex-1 rounded-2xl border border-dashed border-white/15 bg-white/[0.04] px-0 py-3.5 text-[13px] font-bold text-neutral-300 transition active:scale-[0.97] disabled:opacity-60 hover:bg-white/[0.07]"
          >
            Custom
          </button>
        </div>
        {errorBar}
        {customModal}
      </div>
    );
  }

  if (signal.type === "prediction") {
    const yesCents = Math.round(signal.yesProbability * 100);
    const noCents = 100 - yesCents;
    const yesKey = `yes-${predictionStake}`;
    const noKey = `no-${predictionStake}`;
    const yesPending = state.pending === yesKey;
    const noPending = state.pending === noKey;
    const yesConfirmed = state.confirmed === yesKey;
    const noConfirmed = state.confirmed === noKey;
    const PRESETS = [5, 10, 20, 50];
    const isPresetStake = PRESETS.includes(predictionStake);

    function openPredictionStakeModal() {
      if (!requireAuth()) return;
      setPredictionStakeModalOpen(true);
    }

    return (
      <div className="mt-auto pt-4">
        {/* Stake selector — sets the amount for the YES/NO buttons below.
            Tapping a preset just selects it; "Custom" opens the bottom-
            sheet to type any value within the rail's bounds. */}
        <div className="flex items-center gap-1.5">
          <span className="pl-0.5 pr-1 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
            Bet
          </span>
          {PRESETS.map((amt) => {
            const selected = predictionStake === amt;
            return (
              <button
                key={amt}
                onClick={() => setPredictionStake(amt)}
                disabled={!!state.pending}
                className={`flex-1 rounded-lg px-0 py-1.5 text-[12px] font-bold transition active:scale-95 disabled:opacity-60 ${
                  selected
                    ? "bg-white text-black"
                    : "bg-white/10 text-neutral-300 hover:bg-white/15"
                }`}
              >
                ${amt}
              </button>
            );
          })}
          <button
            onClick={openPredictionStakeModal}
            disabled={!!state.pending}
            className={`flex-1 rounded-lg border border-dashed px-0 py-1.5 text-[12px] font-bold transition active:scale-95 disabled:opacity-60 ${
              !isPresetStake
                ? "border-white bg-white text-black"
                : "border-white/15 bg-white/[0.04] text-neutral-300 hover:bg-white/[0.07]"
            }`}
          >
            {!isPresetStake ? `$${predictionStake}` : "Custom"}
          </button>
        </div>

        {/* YES + NO action buttons. The price IS the button — tapping
            buys the selected stake on that side. */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => executePredictionBuy("yes", predictionStake)}
            disabled={!!state.pending}
            className={`relative rounded-2xl border-2 border-[#22c55e] bg-[#22c55e]/10 px-0 py-4 text-center transition active:scale-[0.97] disabled:opacity-60 hover:bg-[#22c55e]/15 ${
              yesConfirmed ? "stake-confirm !bg-[#22c55e]" : ""
            }`}
          >
            <div className="text-[10px] font-black tracking-[1.5px] uppercase text-[#22c55e]">
              YES
            </div>
            <div className="mt-0.5 text-3xl font-black text-[#22c55e]">
              {yesCents}¢
            </div>
            <div className="mt-1 text-[10px] font-bold text-neutral-400">
              {yesConfirmed
                ? "✓ Bought"
                : yesPending
                  ? "Buying…"
                  : `Buy $${predictionStake}`}
            </div>
            {yesConfirmed && <StakeBurst label={`YES +$${predictionStake}`} />}
          </button>
          <button
            onClick={() => executePredictionBuy("no", predictionStake)}
            disabled={!!state.pending}
            className={`relative rounded-2xl border-2 border-[#ef4444] bg-[#ef4444]/10 px-0 py-4 text-center transition active:scale-[0.97] disabled:opacity-60 hover:bg-[#ef4444]/15 ${
              noConfirmed ? "stake-confirm !bg-[#ef4444]" : ""
            }`}
          >
            <div className="text-[10px] font-black tracking-[1.5px] uppercase text-[#ef4444]">
              NO
            </div>
            <div className="mt-0.5 text-3xl font-black text-[#ef4444]">
              {noCents}¢
            </div>
            <div className="mt-1 text-[10px] font-bold text-neutral-400">
              {noConfirmed
                ? "✓ Bought"
                : noPending
                  ? "Buying…"
                  : `Buy $${predictionStake}`}
            </div>
            {noConfirmed && (
              <StakeBurst label={`NO +$${predictionStake}`} tone="fade" />
            )}
          </button>
        </div>

        {errorBar}

        <CustomAmountModal
          open={predictionStakeModalOpen}
          onClose={() => setPredictionStakeModalOpen(false)}
          onConfirm={(amount) => setPredictionStake(amount)}
          title="Bet size"
          actionLabel="Use"
          tone="neutral"
          minUsd={RAIL_MIN.prediction}
          maxUsd={RAIL_MAX}
          initialAmount={predictionStake}
        />
      </div>
    );
  }

  async function executePerp(action: "tail" | "fade", amount: number) {
    if (signal.type !== "whale") return;
    ev.stakeButtonClicked("whale", {
      signal_id: signal.id,
      amount_usdc: amount,
      side: action,
      authenticated,
    });
    if (!requireAuth()) return;
    if (!wallet?.address) {
      flashError("Wallet not ready yet");
      return;
    }
    const key = `${action}-${amount}`;
    setState({ pending: key });
    ev.betStarted("whale", {
      signal_id: signal.id,
      amount_usdc: amount,
      side: action,
    });

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
      ev.betSigned("whale", {
        bet_id: betId,
        amount_usdc: amount,
        tx_hash: sigB58,
      });

      await fetch("/api/bet/perp/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ betId, txHash: sigB58 }),
      });
      ev.betConfirmed("whale", {
        bet_id: betId,
        amount_usdc: amount,
        tx_hash: sigB58,
      });

      flashConfirmed(key);
    } catch (err) {
      console.error("[perp]", err);
      const msg = err instanceof Error ? err.message : String(err);
      flashError(msg.slice(0, 80));
      ev.betFailed("whale", {
        bet_id: betId,
        amount_usdc: amount,
        error: msg.slice(0, 200),
      });
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
      <button
        onClick={() => executePerp("tail", 10)}
        disabled={!!state.pending}
        className={`relative w-full rounded-2xl border border-[#22c55e] bg-[#22c55e] px-0 py-3.5 text-[14px] font-bold text-black transition active:scale-[0.97] disabled:opacity-60 ${
          state.confirmed === "tail-10" ? "stake-confirm ring-4 ring-white/40" : ""
        }`}
      >
        {state.confirmed === "tail-10"
          ? "✓ Copying"
          : state.pending === "tail-10"
            ? "…"
            : "Copy $10"}
        {state.confirmed === "tail-10" && <StakeBurst label="COPIED $10" />}
      </button>
      <div className="mt-2 flex gap-2">
        {[5, 20, 50].map((amt) => {
          const k = `tail-${amt}`;
          const pending = state.pending === k;
          const confirmed = state.confirmed === k;
          return (
            <button
              key={amt}
              onClick={() => executePerp("tail", amt)}
              disabled={!!state.pending}
              className={`relative flex-1 rounded-xl border border-white/5 bg-white/10 px-0 py-2.5 text-[13px] font-bold text-white transition active:scale-[0.97] disabled:opacity-60 ${
                confirmed ? "stake-confirm !border-[#22c55e] !bg-[#22c55e] !text-black" : ""
              }`}
            >
              {confirmed ? "✓" : pending ? "…" : `$${amt}`}
              {confirmed && <StakeBurst label={`COPIED $${amt}`} />}
            </button>
          );
        })}
        <button
          onClick={() => openCustom("tail")}
          disabled={!!state.pending}
          className="flex-1 rounded-xl border border-dashed border-white/15 bg-white/[0.04] px-0 py-2.5 text-[12px] font-bold text-neutral-300 transition active:scale-[0.97] disabled:opacity-60 hover:bg-white/[0.07]"
        >
          Custom
        </button>
      </div>
      {errorBar}
      {customModal}
    </div>
  );
}
