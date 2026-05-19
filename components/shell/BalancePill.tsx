"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { useWalletBalance } from "@/lib/solana/use-usdc-balance";
import { ACCENT, BG, FG, PANEL, FAINT, FONT_DISPLAY } from "@/components/v2/ui";

export function BalancePill() {
  const { ready, authenticated, login } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { totalUsd, loading } = useWalletBalance(wallet?.address);

  if (ready && !authenticated) {
    return (
      <button
        onClick={login}
        className="absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-2xl px-4 py-1.5 text-[11px] font-black uppercase tracking-widest transition active:scale-[0.97] lg:hidden"
        style={{
          background: ACCENT,
          color: BG,
          fontFamily: FONT_DISPLAY,
          boxShadow: `0 3px 0 ${ACCENT}99, inset 0 -2px 0 rgba(0,0,0,0.15)`,
        }}
      >
        LOG IN TO BET
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
    <div
      className="pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2 inline-flex items-baseline gap-2 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-widest lg:hidden"
      style={{
        background: PANEL,
        color: FG,
        border: `1px solid ${FAINT}`,
        fontFamily: FONT_DISPLAY,
      }}
    >
      <span style={{ opacity: 0.5 }}>READY</span>
      <span style={{ color: ACCENT }}>{display}</span>
    </div>
  );
}
