"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import { Connection } from "@solana/web3.js";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { isFlashV2Client } from "@/lib/flash-v2/client-flag";
import { BG, FG, ACCENT, GREEN, DIM, FAINT, PANEL } from "@/components/v2/ui";
import { enableFlashV2Session, revokeFlashV2Session } from "./session-enable";

const RPC =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ?? "https://api.mainnet-beta.solana.com";

type ToggleState = "loading" | "none" | "pending" | "active" | "expired" | "error";

/** "expires in 11h" / "expired 5m ago" from an ISO validUntil. */
function formatExpiry(validUntil: string | null): string {
  if (!validUntil) return "";
  const ms = new Date(validUntil).getTime() - Date.now();
  if (!Number.isFinite(ms)) return "";
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60_000);
  const unit =
    mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
  return ms >= 0 ? `expires in ${unit}` : `expired ${unit} ago`;
}

/**
 * Standalone enable/revoke control for the Flash v2 auto-copy session — lets the
 * user turn the server-signed one-tap key on or off outside the copy-tap flow.
 * Renders nothing unless the client flag is on (v1 has no sessions).
 */
export function SessionToggle() {
  const { authenticated, getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const [state, setState] = useState<ToggleState>("loading");
  const [validUntil, setValidUntil] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    if (!authenticated) return;
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("not authed");
      const r = await fetch("/api/users/me/session", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as { state?: ToggleState; validUntil?: string | null };
      setState((json.state as ToggleState) ?? "none");
      setValidUntil(json.validUntil ?? null);
    } catch {
      setState("error");
    }
  }, [authenticated, getAccessToken]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const confirmBase = useCallback(async (signature: string) => {
    await new Connection(RPC, "confirmed").confirmTransaction(signature, "confirmed");
  }, []);

  const run = useCallback(
    async (action: "enable" | "revoke") => {
      if (!wallet || busy) return;
      setBusy(true);
      setError(null);
      try {
        const deps = {
          getAccessToken,
          wallet,
          signAndSendTransaction,
          confirm: confirmBase,
        };
        if (action === "enable") await enableFlashV2Session(deps);
        else await revokeFlashV2Session(deps);
        await loadStatus();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [wallet, busy, getAccessToken, signAndSendTransaction, confirmBase, loadStatus],
  );

  if (!isFlashV2Client() || !authenticated) return null;

  const on = state === "active";
  const statusLabel =
    state === "loading"
      ? "Checking…"
      : state === "active"
        ? `On · ${formatExpiry(validUntil)}`
        : state === "expired"
          ? "Expired — re-enable to keep one-tap copy"
          : state === "pending"
            ? "Finishing setup…"
            : state === "error"
              ? "Couldn't load status"
              : "Off";

  return (
    <div
      className="rounded-2xl border p-4"
      style={{ background: PANEL, borderColor: FAINT, color: FG }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-widest">
            Auto-copy session
          </div>
          <div
            className="mt-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest"
            style={{ color: on ? GREEN : DIM }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: on ? GREEN : DIM }}
            />
            {statusLabel}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {(state === "none" || state === "pending" || state === "expired") && (
            <button
              onClick={() => void run("enable")}
              disabled={busy || !wallet}
              className="rounded-xl px-4 py-2 text-[11px] font-black uppercase tracking-widest transition active:scale-95 disabled:opacity-50"
              style={{ background: ACCENT, color: BG }}
            >
              {busy ? "…" : state === "expired" ? "Re-enable" : "Enable"}
            </button>
          )}
          {(state === "active" || state === "expired") && (
            <button
              onClick={() => void run("revoke")}
              disabled={busy || !wallet}
              className="rounded-xl px-4 py-2 text-[11px] font-black uppercase tracking-widest transition active:scale-95 disabled:opacity-50"
              style={{ background: "transparent", color: FG, border: `1px solid ${FAINT}` }}
            >
              {busy ? "…" : "Turn off"}
            </button>
          )}
        </div>
      </div>

      <p className="mt-2 text-[10px] leading-relaxed" style={{ color: DIM }}>
        Lets you copy with one tap — no wallet pop-up per trade. The key is
        scoped to Flash trades and expires on its own; turn it off any time.
      </p>

      {error && (
        <p className="mt-2 text-[10px] font-black uppercase tracking-widest" style={{ color: "#ff5470" }}>
          {error}
        </p>
      )}
    </div>
  );
}
