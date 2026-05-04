"use client";

import { useEmbeddedSolanaWallet, truncateAddress } from "@/lib/privy/use-solana-wallet";

export function BalancePill() {
  const wallet = useEmbeddedSolanaWallet();

  if (!wallet) {
    return (
      <div className="pointer-events-none absolute top-[60px] left-1/2 z-20 -translate-x-1/2 rounded-2xl bg-white/10 px-3.5 py-1.5 text-[11px] font-semibold text-white backdrop-blur-xl">
        — ready
      </div>
    );
  }

  return (
    <div className="absolute top-[60px] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-white/10 px-3.5 py-1.5 text-[11px] font-semibold text-white backdrop-blur-xl">
      <span>$0.00 ready</span>
      <span className="text-neutral-500">·</span>
      <span className="font-mono text-neutral-300">{truncateAddress(wallet.address)}</span>
    </div>
  );
}
