"use client";

// CopyModal — arm a standing copy of a target (arena bot or any Flash
// wallet). Creating a subscription is pure DB (no signing); the server-side
// copy ticker mirrors the target's NEXT position into the user's wallet and
// (optionally) closes it when the target exits. Visual language follows
// TailModal: bottom sheet on mobile, centered card on desktop.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

export type CopyModalTarget = {
  kind: "arena-bot" | "flash-wallet" | "whale";
  key: string;
  label: string;
  emoji?: string;
};

const STAKE_CHIPS = [1, 5, 10, 20] as const;
const MIN_USDC = 1;
const MAX_USDC = 1000;

interface SubscriptionResponse {
  subscription?: { id: string };
  error?: string;
}

export function CopyModal({
  open,
  target,
  onClose,
  onArmed,
}: {
  open: boolean;
  target: CopyModalTarget | null;
  onClose: () => void;
  onArmed?: () => void;
}) {
  const { getAccessToken } = usePrivy();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [stake, setStake] = useState<number>(1);
  const [custom, setCustom] = useState<string>("");
  const [autoClose, setAutoClose] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStake(1);
    setCustom("");
    setAutoClose(true);
    setSubmitting(false);
    setError(null);
    setArmed(false);
  }, [open, target?.kind, target?.key]);

  const customStake = Number.parseFloat(custom);
  const effectiveStake =
    custom.trim() !== "" && Number.isFinite(customStake) ? customStake : stake;
  const stakeValid = effectiveStake >= MIN_USDC && effectiveStake <= MAX_USDC;
  const dailyCapUsd = Math.min(effectiveStake * 10, 5000);

  const submit = useCallback(async () => {
    if (!target || submitting) return;
    if (!stakeValid) {
      setError(`Stake must be between $${MIN_USDC} and $${MAX_USDC}`);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("not authed");
      const resp = await fetch("/api/copy/subscriptions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          targetKind: target.kind,
          targetKey: target.key,
          targetLabel: target.label,
          stakeUsdc: effectiveStake,
          leverageMode: "mirror",
          autoClose,
          dailyCapUsd,
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as SubscriptionResponse;
      if (!resp.ok) {
        throw new Error(data.error ?? `HTTP ${resp.status}`);
      }
      setArmed(true);
      onArmed?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [
    target,
    submitting,
    stakeValid,
    effectiveStake,
    autoClose,
    dailyCapUsd,
    getAccessToken,
    onArmed,
  ]);

  if (!open || !target) return null;

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current && !submitting) onClose();
      }}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
    >
      <div className="w-full sm:max-w-md bg-[#0c0c0c] border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-xl">
              {target.emoji ?? (target.kind === "flash-wallet" ? "👤" : "🤖")}
            </div>
            <div>
              <div className="text-xs uppercase tracking-widest text-white/40">
                Copy trader
              </div>
              <div className="text-base font-semibold text-white">
                {target.label}
              </div>
            </div>
          </div>
          <button
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="text-white/40 hover:text-white/80 disabled:opacity-30 text-xl leading-none px-2 py-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {armed ? (
          <div className="px-5 pb-6">
            <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-4 text-center">
              <div className="text-3xl mb-2">🎯</div>
              <div className="text-emerald-300 font-semibold mb-1">
                Copy armed
              </div>
              <div className="text-xs text-emerald-200/80">
                {target.label}&apos;s next position gets mirrored with $
                {effectiveStake}
                {autoClose ? " and closed when they close" : ""}. Manage it
                from Portfolio.
              </div>
            </div>
            <button
              onClick={onClose}
              className="mt-4 w-full py-3 rounded-2xl bg-white text-black font-semibold"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="px-5">
              <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">
                Stake per copied trade (USDC)
              </div>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {STAKE_CHIPS.map((s) => {
                  const active = !custom && stake === s;
                  return (
                    <button
                      key={s}
                      onClick={() => {
                        setStake(s);
                        setCustom("");
                        setError(null);
                      }}
                      disabled={submitting}
                      className={`py-3 rounded-2xl font-semibold text-sm transition border ${
                        active
                          ? "bg-white text-black border-white"
                          : "bg-white/5 text-white/80 border-white/10 hover:bg-white/10"
                      }`}
                    >
                      ${s}
                    </button>
                  );
                })}
              </div>
              <div className="relative mb-3">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40">
                  $
                </span>
                <input
                  inputMode="decimal"
                  placeholder="Custom amount"
                  value={custom}
                  onChange={(e) => {
                    setCustom(e.target.value);
                    setError(null);
                  }}
                  disabled={submitting}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl pl-8 pr-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-white/30"
                />
              </div>

              <button
                type="button"
                onClick={() => setAutoClose((v) => !v)}
                disabled={submitting}
                className="mb-3 flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition hover:bg-white/[0.06]"
              >
                <span
                  aria-hidden
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-black transition ${
                    autoClose
                      ? "border-emerald-400 bg-emerald-400 text-black"
                      : "border-white/25 bg-transparent text-transparent"
                  }`}
                >
                  ✓
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-white">
                    Close when {target.label} closes
                  </span>
                  <span className="block text-[10px] text-white/40">
                    Off = you exit manually from Portfolio
                  </span>
                </span>
              </button>

              <div className="mb-4 rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-3 text-[11px] leading-relaxed text-white/50">
                Mirrors their direction and leverage at your stake. Skips
                entries that already ran &gt;1% past their price. Daily cap $
                {dailyCapUsd.toFixed(0)} · one position at a time.
                {target.kind === "whale" ? (
                  <span className="block mt-1">
                    Executes on Flash — crypto, gold, FX and equity positions
                    mirror; markets Flash doesn&apos;t list are skipped.
                  </span>
                ) : null}
                {effectiveStake * 10 < 10 ? (
                  <span className="block mt-1 text-amber-300/80">
                    Note: Flash needs $10 notional — low-leverage trades under
                    that get skipped.
                  </span>
                ) : null}
              </div>
            </div>

            <div className="px-5 pb-6">
              {error ? (
                <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
                  {error}
                </div>
              ) : null}
              <button
                onClick={() => void submit()}
                disabled={submitting || !stakeValid}
                className="w-full py-3.5 rounded-2xl bg-emerald-400 text-black font-bold text-sm uppercase tracking-widest transition disabled:opacity-40 hover:opacity-90 active:scale-[0.99]"
              >
                {submitting
                  ? "Arming…"
                  : `Copy with $${stakeValid ? effectiveStake : "—"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
