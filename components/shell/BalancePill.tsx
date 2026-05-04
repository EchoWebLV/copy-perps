"use client";

import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { useWalletBalance } from "@/lib/solana/use-usdc-balance";

export function BalancePill() {
  const wallet = useEmbeddedSolanaWallet();
  const { usdc, loading } = useWalletBalance(wallet?.address);

  const display = !wallet
    ? "—"
    : usdc == null
      ? loading
        ? "…"
        : "—"
      : `$${usdc.toFixed(2)}`;

  return (
    <div className="pointer-events-none absolute top-[60px] left-1/2 z-20 -translate-x-1/2 rounded-2xl bg-white/10 px-3.5 py-1.5 text-[11px] font-semibold text-white backdrop-blur-xl">
      {display} ready
    </div>
  );
}
