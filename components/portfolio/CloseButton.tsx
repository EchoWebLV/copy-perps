"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";

export function CloseButton({
  betId,
  onClosed,
}: {
  betId: string;
  onClosed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { getAccessToken } = usePrivy();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const wallet = useEmbeddedSolanaWallet();

  async function close() {
    if (!wallet) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not signed in");

      const r = await fetch("/api/bet/meme/close", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ betId }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.error ?? `HTTP ${r.status}`);
      }
      const { swapTransaction, expectedUsdcOut } = await r.json();

      const txBytes = Uint8Array.from(atob(swapTransaction), (c) =>
        c.charCodeAt(0),
      );
      const result = await signAndSendTransaction({
        transaction: txBytes,
        wallet,
      });
      const sig = bs58.encode(result.signature);

      await fetch("/api/bet/meme/close/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          betId,
          txHash: sig,
          proceedsAtomic: expectedUsdcOut,
        }),
      });

      onClosed();
    } catch (err) {
      console.error("[close]", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={close}
        disabled={busy || !wallet}
        className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition active:scale-95 disabled:opacity-50"
      >
        {busy ? "Closing…" : "Close"}
      </button>
      {error && (
        <div className="mt-1 truncate text-[10px] text-red-400">{error}</div>
      )}
    </div>
  );
}
