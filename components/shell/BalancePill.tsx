"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { useWalletBalance } from "@/lib/solana/use-usdc-balance";

export function BalancePill() {
  const { ready, authenticated, login } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { totalUsd, loading } = useWalletBalance(wallet?.address);

  // Anonymous visitors see a clickable "Log in" pill where the balance
  // would otherwise sit. Tap → Privy login modal. Same screen real
  // estate, different action.
  if (ready && !authenticated) {
    return (
      <button
        onClick={login}
        className="absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-2xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-1.5 text-[11px] font-bold tracking-[1px] text-emerald-300 uppercase shadow-[0_0_24px_rgba(16,185,129,0.18)] backdrop-blur-xl transition active:scale-95 hover:bg-emerald-500/20"
      >
        Log in to bet
      </button>
    );
  }

  const display = !wallet
    ? "—"
    : totalUsd == null
      ? loading
        ? "…"
        : "—"
      : `$${totalUsd.toFixed(2)}`;

  return (
    <div className="pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-2xl border border-emerald-400/30 bg-emerald-500/15 px-3.5 py-1.5 text-[11px] font-semibold text-emerald-300 shadow-[0_0_24px_rgba(16,185,129,0.18)] backdrop-blur-xl">
      {display} ready
    </div>
  );
}
