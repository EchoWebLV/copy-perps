"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction } from "@privy-io/react-auth/solana";
import { Connection } from "@solana/web3.js";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import {
  decodeBase64Tx,
  postBetWithConsolidation,
  signAndSubmitTx,
} from "@/lib/bets/post-with-consolidation";

const RPC_URL =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ?? "https://api.mainnet-beta.solana.com";

interface Props {
  maxUsd: number;
  onComplete: () => void;
}

export function WithdrawButton({ maxUsd, onComplete }: Props) {
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { getAccessToken } = usePrivy();
  const { signTransaction } = useSignTransaction();
  const wallet = useEmbeddedSolanaWallet();

  function close() {
    if (busy) return;
    setOpen(false);
    setDestination("");
    setAmount("");
    setError(null);
    setSuccess(null);
  }

  async function submit() {
    setError(null);
    setSuccess(null);
    if (!wallet) return setError("Wallet not ready");
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return setError("Enter a valid amount");
    }
    if (amt > maxUsd) {
      return setError(`Max $${maxUsd.toFixed(2)} available`);
    }
    if (!destination.trim()) return setError("Enter a destination address");

    setBusy(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not signed in");

      // postBetWithConsolidation handles the consolidate->transfer
      // dance: if the user is short USDC but has jupUSD, the server
      // returns phase=consolidate first, the helper signs+submits the
      // swap, then re-calls and returns the transfer payload here.
      const data = await postBetWithConsolidation(
        "/api/withdraw",
        { destination: destination.trim(), amountUsd: amt },
        token,
        wallet,
        signTransaction,
      );
      const txBytes = decodeBase64Tx(
        data.transferTransaction,
        "withdraw transfer",
      );
      const sig = await signAndSubmitTx(txBytes, wallet, signTransaction);

      // Confirm so the success state actually means landed-on-chain.
      const conn = new Connection(RPC_URL, "confirmed");
      const conf = await conn.confirmTransaction(sig, "confirmed");
      if (conf.value.err) {
        throw new Error(`tx failed: ${JSON.stringify(conf.value.err)}`);
      }

      setSuccess(`Sent $${amt.toFixed(2)} USDC. Tx: ${sig.slice(0, 12)}…`);
      onComplete();
      setTimeout(() => close(), 3000);
    } catch (err) {
      console.error("[withdraw]", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={maxUsd <= 0}
        className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-white transition active:scale-95 disabled:opacity-40"
      >
        Withdraw
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-t-3xl border-t border-white/10 bg-neutral-950 p-5 pb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-extrabold">Withdraw USDC</h2>
          <button
            onClick={close}
            disabled={busy}
            className="text-2xl leading-none text-neutral-500 disabled:opacity-40"
          >
            ×
          </button>
        </div>

        <label className="mb-1 block text-[10px] uppercase tracking-wider text-neutral-500">
          Destination address
        </label>
        <input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          disabled={busy}
          placeholder="Solana address"
          className="mb-3 w-full rounded-xl bg-white/5 px-3 py-3 font-mono text-xs text-white outline-none ring-1 ring-white/5 focus:ring-white/20"
        />

        <div className="mb-1 flex items-baseline justify-between">
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
            Amount (USD)
          </label>
          <button
            type="button"
            onClick={() => setAmount(maxUsd.toFixed(2))}
            disabled={busy}
            className="text-[11px] font-bold text-neutral-300 hover:text-white"
          >
            Max ${maxUsd.toFixed(2)}
          </button>
        </div>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
          inputMode="decimal"
          placeholder="0.00"
          className="mb-1 w-full rounded-xl bg-white/5 px-3 py-3 text-xl font-bold text-white outline-none ring-1 ring-white/5 focus:ring-white/20"
        />
        <div className="mb-4 text-[10px] text-neutral-600">
          jupUSD will be auto-converted to USDC if needed (one extra signature).
        </div>

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
          onClick={submit}
          disabled={busy}
          className="w-full rounded-2xl bg-white py-3 text-sm font-bold text-black transition active:scale-95 disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
