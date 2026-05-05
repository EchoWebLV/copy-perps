"use client";

import { useEffect, useRef, useState } from "react";

export interface CustomAmountModalProps {
  open: boolean;
  onClose: () => void;
  // Called with a validated number when the user confirms. The caller
  // is responsible for triggering the actual bet flow.
  onConfirm: (amount: number) => void;
  title: string;
  // Action verb shown on the confirm button: "Buy", "Tail", "YES",
  // etc. Combines into "Buy $12.50".
  actionLabel: string;
  // Tone controls the confirm button color.
  tone?: "win" | "fade" | "neutral";
  minUsd: number;
  maxUsd: number;
  // Initial value to populate the input. Useful for "remember last
  // custom amount" UX. Falls back to the minimum.
  initialAmount?: number;
}

const QUICK_PRESETS_BY_MIN: Record<number, number[]> = {
  1: [1, 3, 7, 25, 100],
  5: [5, 15, 30, 100, 250],
};

function pickPresets(minUsd: number, maxUsd: number): number[] {
  const baseline = QUICK_PRESETS_BY_MIN[minUsd] ?? QUICK_PRESETS_BY_MIN[5];
  return baseline.filter((v) => v >= minUsd && v <= maxUsd);
}

export function CustomAmountModal({
  open,
  onClose,
  onConfirm,
  title,
  actionLabel,
  tone = "win",
  minUsd,
  maxUsd,
  initialAmount,
}: CustomAmountModalProps) {
  const [raw, setRaw] = useState<string>(
    initialAmount != null ? String(initialAmount) : "",
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset + focus when the modal is opened. Without this re-mount the
  // last-used value sticks around and the keyboard doesn't pop up on
  // mobile second open.
  useEffect(() => {
    if (!open) return;
    setRaw(initialAmount != null ? String(initialAmount) : "");
    // Brief delay so the slide-in finishes before iOS focuses the input
    // (otherwise the keyboard can interrupt the animation).
    const t = setTimeout(() => inputRef.current?.focus(), 220);
    return () => clearTimeout(t);
  }, [open, initialAmount]);

  // ESC closes the modal — convenient on desktop / iPad keyboards.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const parsed = Number.parseFloat(raw);
  const valid = Number.isFinite(parsed) && parsed >= minUsd && parsed <= maxUsd;
  const errorHint = !raw
    ? null
    : !Number.isFinite(parsed)
      ? "Enter a number"
      : parsed < minUsd
        ? `Minimum is $${minUsd}`
        : parsed > maxUsd
          ? `Maximum is $${maxUsd}`
          : null;

  const confirmTone =
    tone === "fade"
      ? "bg-[#ef4444] text-white"
      : tone === "neutral"
        ? "bg-white text-black"
        : "bg-[#22c55e] text-black";

  function handleConfirm() {
    if (!valid) return;
    onConfirm(parsed);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl border-t border-x border-white/10 bg-neutral-950 px-5 pt-5 pb-6 sm:rounded-3xl sm:border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15 sm:hidden" />

        <div className="text-[11px] font-bold uppercase tracking-[1.5px] text-neutral-500">
          Custom amount
        </div>
        <div className="mt-1 text-lg font-bold leading-tight">{title}</div>

        <div className="mt-5">
          <div className="flex items-baseline gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5">
            <span className="text-2xl font-black text-neutral-500">$</span>
            <input
              ref={inputRef}
              type="number"
              inputMode="decimal"
              step="0.01"
              min={minUsd}
              max={maxUsd}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirm();
              }}
              placeholder={String(minUsd)}
              className="flex-1 bg-transparent text-3xl font-black text-white outline-none placeholder:text-neutral-700 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="text-neutral-500">
              Min ${minUsd} · Max ${maxUsd}
            </span>
            {errorHint ? (
              <span className="font-bold text-[#fca5a5]">{errorHint}</span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {pickPresets(minUsd, maxUsd).map((amt) => (
            <button
              key={amt}
              onClick={() => setRaw(String(amt))}
              className="flex-1 rounded-xl bg-white/[0.06] px-0 py-2 text-[12px] font-bold text-white transition active:scale-95 hover:bg-white/10"
            >
              ${amt}
            </button>
          ))}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-0 py-3.5 text-[14px] font-bold text-neutral-300 transition active:scale-[0.97] hover:bg-white/[0.07]"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!valid}
            className={`flex-[2] rounded-2xl px-0 py-3.5 text-[14px] font-bold transition active:scale-[0.97] disabled:opacity-50 ${confirmTone}`}
          >
            {actionLabel} {valid ? `$${parsed}` : `$${minUsd}+`}
          </button>
        </div>
      </div>
    </div>
  );
}
