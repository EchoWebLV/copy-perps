"use client";

import { useCallback, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { formatCopySourceLabel } from "@/lib/positions/copy-row";

export interface CopyRowData {
  betId: string;
  market: string;
  side: "long" | "short";
  leverage: number;
  stakeUsdc: number;
  leaderAddress: string | null;
  leaderUsername: string | null;
  whaleId?: string | null;
  whaleName?: string | null;
  autoCloseOnSourceClose?: boolean;
  closeReason?: "manual" | "source_closed" | "already_flat" | null;
  botId: string | null;
  botName: string | null;
  unrealizedPnlPct: number | null;
  leaderClosedAt: string | null;
}

interface Props {
  row: CopyRowData;
  onClosed: (betId: string) => void;
}

export function CopyRow({ row, onClosed }: Props) {
  const { getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const handleClose = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatus("Closing...");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("not authed");
      const r = await fetch("/api/bet/copy/close", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ betId: row.betId, walletAddress: wallet?.address }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.error ?? `HTTP ${r.status}`);
      }
      setStatus("Closed");
      onClosed(row.betId);
    } catch (err) {
      setStatus(`Failed: ${String(err).slice(0, 80)}`);
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(null), 4000);
    }
  }, [busy, getAccessToken, onClosed, row.betId, wallet?.address]);

  return (
    <div className="flex items-center justify-between rounded-2xl bg-white/5 p-4">
      <div>
        <div className="text-sm font-semibold">
          {row.market} {row.side.toUpperCase()} {Math.round(row.leverage)}x
        </div>
        <div className="text-xs text-white/60">
          Stake ${row.stakeUsdc} · Copying {formatCopySourceLabel(row)}
        </div>
        <div className="mt-1 text-xs font-semibold text-white/50">
          {row.autoCloseOnSourceClose ? "AUTO-CLOSE ON" : "MANUAL CLOSE"}
        </div>
        {row.closeReason === "source_closed" && (
          <div className="mt-1 text-xs text-amber-300">
            Closed after whale exited
          </div>
        )}
        {row.closeReason === "already_flat" && (
          <div className="mt-1 text-xs text-amber-300">
            Already flat when whale exited
          </div>
        )}
        {row.leaderClosedAt && !row.closeReason && (
          <div className="mt-1 text-xs text-amber-300">
            Leader exited. Close yours to settle.
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        {row.unrealizedPnlPct !== null && (
          <div
            className={
              row.unrealizedPnlPct >= 0 ? "text-green-400" : "text-rose-400"
            }
          >
            {row.unrealizedPnlPct >= 0 ? "+" : ""}
            {row.unrealizedPnlPct.toFixed(1)}%
          </div>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={handleClose}
          className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-semibold disabled:opacity-40"
        >
          {busy ? "..." : "Close"}
        </button>
      </div>
      {status && <div className="ml-3 text-xs text-white/70">{status}</div>}
    </div>
  );
}
