"use client";

import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { useWalletBalance } from "@/lib/solana/use-usdc-balance";

export function BalancePill() {
  const wallet = useEmbeddedSolanaWallet();
  const { totalUsd, loading } = useWalletBalance(wallet?.address);

  const display = !wallet
    ? "—"
    : totalUsd == null
      ? loading
        ? "…"
        : "—"
      : `$${totalUsd.toFixed(2)}`;

  return (
    <div className="pointer-events-none absolute top-[60px] left-1/2 z-20 -translate-x-1/2 rounded-2xl border border-emerald-400/30 bg-emerald-500/15 px-3.5 py-1.5 text-[11px] font-semibold text-emerald-300 shadow-[0_0_24px_rgba(16,185,129,0.18)] backdrop-blur-xl">
      {display} ready
    </div>
  );
}
