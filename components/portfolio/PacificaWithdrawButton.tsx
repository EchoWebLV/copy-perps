"use client";

import { useCallback, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";

interface Props {
  onComplete: () => void;
}

// "Cash Out" — pulls USDC out of the user's Pacifica trading account back
// to their own wallet. The agent wallet signs the withdraw server-side, so
// there is no wallet-signing modal; Pacifica settles to the account owner.
export function PacificaWithdrawButton({ onComplete }: Props) {
  const { getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [withdrawable, setWithdrawable] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const openModal = useCallback(async () => {
    setOpen(true);
    setWithdrawable(null);
    setAmount("");
    setError(null);
    setSuccess(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not signed in");
      const r = await fetch("/api/withdraw/pacifica", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const b = (await r.json().catch(() => ({}))) as {
        withdrawable?: number;
        error?: string;
      };
      if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
      setWithdrawable(typeof b.withdrawable === "number" ? b.withdrawable : 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setWithdrawable(0);
    }
  }, [getAccessToken]);

  function close() {
    if (busy) return;
    setOpen(false);
  }

  async function submit() {
    setError(null);
    setSuccess(null);
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Enter a valid amount");
      return;
    }
    if (withdrawable != null && amt > withdrawable + 1e-6) {
      setError(`Max $${withdrawable.toFixed(2)} available`);
      return;
    }
    setBusy(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not signed in");
      const r = await fetch("/api/withdraw/pacifica", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          amountUsdc: amt,
          walletAddress: wallet?.address,
        }),
      });
      const b = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
      setSuccess(`Withdrew $${amt.toFixed(2)} to your wallet.`);
      onComplete();
      setTimeout(() => setOpen(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => void openModal()}
        className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-white transition active:scale-95"
      >
        Cash Out
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-t-3xl border-t border-white/10 bg-neutral-950 p-5 pb-8">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-extrabold">Cash Out</h2>
          <button
            onClick={close}
            disabled={busy}
            className="text-2xl leading-none text-neutral-500 disabled:opacity-40"
          >
            ×
          </button>
        </div>
        <p className="mb-4 text-[11px] text-neutral-500">
          Pulls USDC out of your Pacifica trading account back to your wallet.
        </p>

        <div className="mb-1 flex items-baseline justify-between">
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
            Amount (USD)
          </label>
          <button
            type="button"
            onClick={() =>
              withdrawable != null && setAmount(withdrawable.toFixed(2))
            }
            disabled={busy || withdrawable == null}
            className="text-[11px] font-bold text-neutral-300 hover:text-white disabled:opacity-40"
          >
            {withdrawable == null
              ? "Loading…"
              : `Max $${withdrawable.toFixed(2)}`}
          </button>
        </div>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
          inputMode="decimal"
          placeholder="0.00"
          className="mb-4 w-full rounded-xl bg-white/5 px-3 py-3 text-xl font-bold text-white outline-none ring-1 ring-white/5 focus:ring-white/20"
        />

        {error && (
          <div className="mb-3 rounded-xl bg-red-500/15 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-3 rounded-xl bg-[#22c55e]/15 px-3 py-2 text-xs text-[#22c55e]">
            {success}
          </div>
        )}

        <button
          onClick={() => void submit()}
          disabled={busy || withdrawable == null}
          className="w-full rounded-2xl bg-white py-3 text-sm font-bold text-black transition active:scale-95 disabled:opacity-50"
        >
          {busy ? "Withdrawing…" : "Withdraw"}
        </button>
      </div>
    </div>
  );
}
