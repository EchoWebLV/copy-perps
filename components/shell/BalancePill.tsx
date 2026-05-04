"use client";

import { useEmbeddedSolanaWallet, truncateAddress } from "@/lib/privy/use-solana-wallet";
import { useWalletBalance } from "@/lib/solana/use-usdc-balance";

export function BalancePill() {
  const wallet = useEmbeddedSolanaWallet();
  const { usdc, loading } = useWalletBalance(wallet?.address);

  if (!wallet) {
    return (
      <div className="pointer-events-none absolute top-[60px] left-1/2 z-20 -translate-x-1/2 rounded-2xl bg-white/10 px-3.5 py-1.5 text-[11px] font-semibold text-white backdrop-blur-xl">
        — ready
      </div>
    );
  }

  const display =
    usdc == null
      ? loading
        ? "Loading…"
        : "—"
      : `$${usdc.toFixed(2)}`;

  return (
    <div className="absolute top-[60px] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-white/10 px-3.5 py-1.5 text-[11px] font-semibold text-white backdrop-blur-xl">
      <span>{display} ready</span>
      <span className="text-neutral-500">·</span>
      <span className="font-mono text-neutral-300">{truncateAddress(wallet.address)}</span>
    </div>
  );
}
