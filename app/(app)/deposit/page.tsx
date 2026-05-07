"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useFundWallet } from "@privy-io/react-auth/solana";
import { useState } from "react";
import { Copy, Check, LogOut, CreditCard } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { ev } from "@/lib/analytics";

const DEFAULT_FUND_AMOUNT_USD = "25";

export default function DepositPage() {
  const { ready, authenticated, login, logout } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { fundWallet } = useFundWallet();
  const [copied, setCopied] = useState(false);
  const [funding, setFunding] = useState(false);

  const copy = async () => {
    if (!wallet?.address) return;
    await navigator.clipboard.writeText(wallet.address);
    ev.depositAddressCopied();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const buyWithCard = async () => {
    if (!wallet?.address || funding) return;
    ev.fundWithCardClicked();
    setFunding(true);
    try {
      await fundWallet({
        address: wallet.address,
        options: {
          asset: "USDC",
          amount: DEFAULT_FUND_AMOUNT_USD,
          defaultFundingMethod: "card",
          card: { preferredProvider: "moonpay" },
        },
      });
      ev.fundWithCardCompleted();
    } catch (err) {
      ev.fundWithCardFailed({
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setFunding(false);
    }
  };

  return (
    <main className="flex min-h-full flex-col items-center px-6 pt-16 pb-28 text-center">
      <h1 className="text-3xl font-bold">Deposit</h1>

      {!ready && <p className="mt-3 text-sm text-neutral-500">Loading…</p>}

      {ready && !authenticated && (
        <>
          <p className="mt-3 max-w-sm text-neutral-400">
            Log in to fund your wallet.
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
            Fund with a card, or send USDC (Solana) directly.
          </p>

          <button
            onClick={buyWithCard}
            disabled={!wallet?.address || funding}
            className="mt-8 flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl bg-green-500 px-6 py-4 text-base font-bold text-black transition active:scale-[0.97] disabled:opacity-40"
          >
            <CreditCard size={18} />
            {funding ? "Opening…" : "Buy USDC with card"}
          </button>

          <div className="mt-6 w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6 text-left">
            <div className="text-[11px] tracking-wider text-neutral-500 uppercase">
              Or send USDC (Solana) to
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
            onClick={logout}
            className="mt-8 flex items-center gap-2 text-xs text-neutral-500 transition hover:text-neutral-300"
          >
            <LogOut size={12} /> Log out
          </button>
        </>
      )}

      <BottomNav />
    </main>
  );
}
