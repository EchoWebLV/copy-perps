"use client";

// Portfolio "Copy trading" section: the user's standing copy subscriptions
// (pause / resume / stop) plus the entry point for copying an arbitrary
// Flash wallet by address. Money rows (the copies themselves) render in the
// normal open/closed position lists — this panel only manages instructions.

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { ACCENT, BG, DIM, FAINT, FG, GREEN, PANEL, PANEL_2, RED, Stamp } from "@/components/v2/ui";
import { CopyModal, type CopyModalTarget } from "./CopyModal";

interface SubscriptionListItem {
  id: string;
  targetKind: "arena-bot" | "flash-wallet";
  targetKey: string;
  targetLabel: string | null;
  stakeUsdc: number;
  leverageMode: string;
  fixedLeverage: number | null;
  autoClose: boolean;
  dailyCapUsd: number;
  status: "active" | "paused" | "stopped";
  openCopies: number;
  spent24hUsd: number;
}

function shortKey(key: string): string {
  return key.length <= 12 ? key : `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function CopyTradingPanel() {
  const { authenticated, getAccessToken } = usePrivy();
  const [subs, setSubs] = useState<SubscriptionListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [walletInput, setWalletInput] = useState("");
  const [walletTarget, setWalletTarget] = useState<CopyModalTarget | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!authenticated) return;
    try {
      const token = await getAccessToken();
      if (!token) return;
      const r = await fetch("/api/copy/subscriptions", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { subscriptions: SubscriptionListItem[] };
      setSubs(data.subscriptions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [authenticated, getAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (id: string, status: "active" | "paused" | "stopped") => {
      setBusyId(id);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("not authed");
        const r = await fetch("/api/copy/subscriptions", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ id, status }),
        });
        if (!r.ok) {
          const e = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error ?? `HTTP ${r.status}`);
        }
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [getAccessToken, load],
  );

  if (!authenticated) return null;

  return (
    <div
      className="p-4"
      style={{ background: PANEL, borderRadius: 14, border: `1px solid ${FAINT}` }}
    >
      <div className="flex items-center justify-between">
        <Stamp label="Copy trading" />
        {subs !== null && subs.length > 0 ? (
          <span
            className="text-[9px] font-black uppercase tracking-widest"
            style={{ color: DIM }}
          >
            {subs.filter((s) => s.status === "active").length} active
          </span>
        ) : null}
      </div>

      {error ? (
        <div
          className="mt-3 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest"
          style={{ background: `${RED}20`, color: RED, border: `1px solid ${RED}40` }}
        >
          {error}
        </div>
      ) : null}

      {subs === null ? (
        <div
          className="mt-3 text-[10px] font-black uppercase tracking-widest"
          style={{ color: DIM }}
        >
          Loading…
        </div>
      ) : subs.length === 0 ? (
        <div
          className="mt-3 text-[10px] font-black uppercase tracking-widest leading-relaxed"
          style={{ color: DIM }}
        >
          Not copying anyone yet. Hit COPY on a bot in the feed, or paste a
          Flash trader&apos;s wallet below.
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {subs.map((sub) => {
            const paused = sub.status === "paused";
            return (
              <div
                key={sub.id}
                className="rounded-xl px-3 py-2.5"
                style={{ background: PANEL_2, border: `1px solid ${FAINT}` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-black uppercase">
                        {sub.targetLabel ?? shortKey(sub.targetKey)}
                      </span>
                      <span
                        className="rounded px-1 py-0.5 text-[8px] font-black uppercase tracking-widest"
                        style={{
                          background: paused ? `${DIM}22` : `${GREEN}22`,
                          color: paused ? DIM : GREEN,
                        }}
                      >
                        {paused ? "Paused" : "Live"}
                      </span>
                    </div>
                    <div
                      className="mt-1 text-[9px] font-black uppercase tracking-widest"
                      style={{ color: DIM }}
                    >
                      ${sub.stakeUsdc} / trade ·{" "}
                      {sub.leverageMode === "fixed"
                        ? `${sub.fixedLeverage}x`
                        : "mirror lev"}{" "}
                      · {sub.autoClose ? "auto-close" : "manual exit"} · $
                      {sub.spent24hUsd.toFixed(0)}/{sub.dailyCapUsd.toFixed(0)} today
                      {sub.openCopies > 0 ? ` · ${sub.openCopies} open` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      onClick={() => void patch(sub.id, paused ? "active" : "paused")}
                      disabled={busyId === sub.id}
                      className="rounded-lg px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest transition active:scale-95 disabled:opacity-40"
                      style={{
                        background: paused ? ACCENT : PANEL,
                        color: paused ? BG : FG,
                        border: `1px solid ${FAINT}`,
                      }}
                    >
                      {paused ? "Resume" : "Pause"}
                    </button>
                    <button
                      onClick={() => void patch(sub.id, "stopped")}
                      disabled={busyId === sub.id}
                      className="rounded-lg px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest transition active:scale-95 disabled:opacity-40"
                      style={{ background: PANEL, color: RED, border: `1px solid ${RED}40` }}
                    >
                      Stop
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Copy any Flash trader by wallet. */}
      <div className="mt-3 flex gap-2">
        <input
          value={walletInput}
          onChange={(e) => setWalletInput(e.target.value)}
          placeholder="Flash trader wallet address"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-xl border bg-transparent px-3 py-2.5 font-mono text-[11px] outline-none placeholder:text-white/25"
          style={{ borderColor: FAINT, color: FG }}
        />
        <button
          onClick={() => {
            const key = walletInput.trim();
            if (key.length < 32) {
              setError("That doesn't look like a Solana wallet address");
              return;
            }
            setError(null);
            setWalletTarget({
              kind: "flash-wallet",
              key,
              label: shortKey(key),
              emoji: "👤",
            });
          }}
          className="shrink-0 rounded-xl px-3 py-2.5 text-[10px] font-black uppercase tracking-widest transition active:scale-95"
          style={{ background: ACCENT, color: BG }}
        >
          Copy
        </button>
      </div>

      <CopyModal
        open={walletTarget !== null}
        target={walletTarget}
        onClose={() => {
          setWalletTarget(null);
          setWalletInput("");
          void load();
        }}
      />
    </div>
  );
}
