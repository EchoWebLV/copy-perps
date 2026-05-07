"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";
import { Copy, Check, LogOut, SlidersHorizontal } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { usePreferences } from "@/components/onboarding/PreferencesProvider";
import { ev } from "@/lib/analytics";

export default function DepositPage() {
  const { ready, authenticated, login, logout } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { open: openPreferences } = usePreferences();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!wallet?.address) return;
    await navigator.clipboard.writeText(wallet.address);
    ev.depositAddressCopied();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <main className="flex min-h-full flex-col items-center px-6 pt-16 pb-28 text-center">
      <h1 className="text-3xl font-bold">Deposit</h1>

      {!ready && <p className="mt-3 text-sm text-neutral-500">Loading…</p>}

      {ready && !authenticated && (
        <>
          <p className="mt-3 max-w-sm text-neutral-400">
            Log in to see your Solana wallet address.
          </p>
          <button
            onClick={() => {
              ev.loginClicked("deposit");
              login();
            }}
            className="mt-8 rounded-2xl bg-white px-8 py-4 text-base font-bold text-black transition active:scale-[0.97]"
          >
            Log in
          </button>
        </>
      )}

      {ready && authenticated && (
        <>
          <p className="mt-3 max-w-sm text-neutral-400">
            Send USDC (Solana) to this address. Phase 1 will add a MoonPay fiat ramp.
          </p>

          <div className="mt-8 w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6 text-left">
            <div className="text-[11px] tracking-wider text-neutral-500 uppercase">
              Your Solana address
            </div>
            <div className="mt-2 break-all font-mono text-sm text-neutral-200">
              {wallet?.address ?? "Generating wallet…"}
            </div>
            <button
              onClick={copy}
              disabled={!wallet?.address}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 py-3 text-sm font-semibold text-white transition active:scale-[0.97] disabled:opacity-40"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Copied" : "Copy address"}
            </button>
          </div>

          <button
            onClick={openPreferences}
            className="mt-8 flex items-center gap-2 text-xs text-neutral-500 transition hover:text-neutral-300"
          >
            <SlidersHorizontal size={12} /> Feed preferences
          </button>

          <button
            onClick={logout}
            className="mt-3 flex items-center gap-2 text-xs text-neutral-500 transition hover:text-neutral-300"
          >
            <LogOut size={12} /> Log out
          </button>
        </>
      )}

      <BottomNav />
    </main>
  );
}
