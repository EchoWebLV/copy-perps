"use client";

import { useState } from "react";
import type { Signal, StakeAmount } from "@/lib/types";

const amounts: StakeAmount[] = [5, 10, 20, 50];

interface Props {
  signal: Signal;
}

export function StakeButtons({ signal }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const fire = (action: string, amount: StakeAmount) => {
    const key = `${action}-${amount}`;
    setPending(key);
    setTimeout(() => {
      setPending(null);
      setConfirmed(key);
      setTimeout(() => setConfirmed(null), 1200);
    }, 600);
    if (typeof window !== "undefined") {
      console.log(`[bet:${signal.type}]`, signal.id, action, amount);
    }
  };

  const renderQuickRow = (action = "buy") => (
    <div className="flex gap-2">
      {[5, 10, 20].map((amt) => {
        const key = `${action}-${amt}`;
        const isConfirmed = confirmed === key;
        const isPending = pending === key;
        const isPrimary = amt === 10;
        return (
          <button
            key={amt}
            onClick={() => fire(action, amt as StakeAmount)}
            className={`flex-1 rounded-2xl border px-0 py-3.5 text-[15px] font-bold transition active:scale-[0.97] ${
              isPrimary
                ? "border-white bg-white text-black"
                : "border-white/5 bg-white/10 text-white"
            } ${isConfirmed ? "!bg-[#22c55e] !text-black !border-[#22c55e]" : ""}`}
            disabled={isPending}
          >
            {isConfirmed ? "✓" : `$${amt}`}
          </button>
        );
      })}
    </div>
  );

  if (signal.type === "meme") {
    return (
      <div className="mt-auto pt-4">
        {renderQuickRow("buy")}
        <div className="mt-3 text-center text-[11px] text-neutral-600">
          Executes on Jupiter Swap · ↑ swipe for next
        </div>
      </div>
    );
  }

  if (signal.type === "prediction") {
    return (
      <div className="mt-auto pt-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => fire("yes", 10)}
            className={`rounded-2xl border border-[#22c55e] bg-[#22c55e] px-0 py-3.5 text-[14px] font-bold text-black transition active:scale-[0.97] ${
              confirmed === "yes-10" ? "ring-4 ring-white/40" : ""
            }`}
          >
            {confirmed === "yes-10" ? "✓ Bought $10 YES" : "$10 YES"}
          </button>
          <button
            onClick={() => fire("no", 10)}
            className={`rounded-2xl border border-[#ef4444] bg-[#ef4444] px-0 py-3.5 text-[14px] font-bold text-white transition active:scale-[0.97] ${
              confirmed === "no-10" ? "ring-4 ring-white/40" : ""
            }`}
          >
            {confirmed === "no-10" ? "✓ Bought $10 NO" : "$10 NO"}
          </button>
        </div>
        <div className="mt-2 flex gap-2">
          {amounts.slice(0, 3).map((amt) => (
            <button
              key={amt}
              onClick={() => fire("yes", amt)}
              className="flex-1 rounded-xl border border-white/5 bg-white/10 px-0 py-2.5 text-[13px] font-bold text-white transition active:scale-[0.97]"
            >
              ${amt}
            </button>
          ))}
        </div>
        <div className="mt-3 text-center text-[11px] text-neutral-600">
          Executes on Jupiter Prediction · ↑ swipe for next
        </div>
      </div>
    );
  }

  // whale
  return (
    <div className="mt-auto pt-4">
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => fire("tail", 10)}
          className={`rounded-2xl border border-[#22c55e] bg-[#22c55e] px-0 py-3.5 text-[14px] font-bold text-black transition active:scale-[0.97] ${
            confirmed === "tail-10" ? "ring-4 ring-white/40" : ""
          }`}
        >
          {confirmed === "tail-10" ? "✓ Tailing" : "Tail $10"}
        </button>
        <button
          onClick={() => fire("fade", 10)}
          className={`rounded-2xl border border-neutral-700 bg-neutral-800 px-0 py-3.5 text-[14px] font-bold text-white transition active:scale-[0.97] ${
            confirmed === "fade-10" ? "ring-4 ring-white/40" : ""
          }`}
        >
          {confirmed === "fade-10" ? "✓ Fading" : "Fade $10"}
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        {amounts.slice(0, 3).map((amt) => (
          <button
            key={amt}
            onClick={() => fire("tail", amt)}
            className="flex-1 rounded-xl border border-white/5 bg-white/10 px-0 py-2.5 text-[13px] font-bold text-white transition active:scale-[0.97]"
          >
            ${amt}
          </button>
        ))}
      </div>
      <div className="mt-3 text-center text-[11px] text-neutral-600">
        Executes on Jupiter Perps · ↑ swipe for next
      </div>
    </div>
  );
}
