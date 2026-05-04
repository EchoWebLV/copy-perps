"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";

interface Props {
  betId: string;
  apiBase: "/api/bet/meme" | "/api/bet/prediction" | "/api/bet/perp";
  onClosed: () => void;
}

export function CloseButton({ betId, apiBase, onClosed }: Props) {
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

      const r = await fetch(`${apiBase}/close`, {
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
      const data = await r.json();
      // Meme returns expectedUsdcOut (atomic USDC); prediction returns
      // expectedProceedsAtomic (also micro-USD = USDC atomic units).
      const proceedsAtomic =
        data.expectedUsdcOut ?? data.expectedProceedsAtomic;

      const txBytes = Uint8Array.from(atob(data.swapTransaction), (c) =>
        c.charCodeAt(0),
      );
      const result = await signAndSendTransaction({
        transaction: txBytes,
        wallet,
      });
      const sig = bs58.encode(result.signature);

      await fetch(`${apiBase}/close/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          betId,
          txHash: sig,
          proceedsAtomic,
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
