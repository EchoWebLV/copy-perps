"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Share2, Check } from "lucide-react";

interface Props {
  betId: string;
  alreadyShared: boolean;
  onShared: () => void;
}

// Tap → POST /api/share. If the bet is confirmed (open) it appears on
// the leaderboard as a live card; if it's closed, as a final card. The
// transition between live and final is automatic on subsequent close.
export function ShareButton({ betId, alreadyShared, onShared }: Props) {
  const [busy, setBusy] = useState(false);
  const [justShared, setJustShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { getAccessToken } = usePrivy();

  async function share() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not signed in");
      const r = await fetch("/api/share", {
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
      setJustShared(true);
      // Drop the "Shared" confirmation after a beat so the row settles
      // back to the steady-state badge style on the next portfolio poll.
      setTimeout(() => setJustShared(false), 2000);
      onShared();
    } catch (err) {
      console.error("[share]", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (alreadyShared) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-lg bg-[#22c55e]/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#22c55e]"
        title="On the leaderboard"
      >
        <Check size={10} strokeWidth={3} />
        Shared
      </span>
    );
  }

  return (
    <div>
      <button
        onClick={share}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white transition active:scale-95 disabled:opacity-50"
      >
        <Share2 size={10} strokeWidth={2.5} />
        {busy ? "Sharing" : justShared ? "Shared" : "Share"}
      </button>
      {error && (
        <div className="mt-1 truncate text-[10px] text-red-400">{error}</div>
      )}
    </div>
  );
}
