"use client";

export function BalancePill({ balance = 83.4 }: { balance?: number }) {
  return (
    <div className="pointer-events-none absolute top-[60px] left-1/2 z-20 -translate-x-1/2 rounded-2xl bg-white/10 px-3.5 py-1.5 text-[11px] font-semibold text-white backdrop-blur-xl">
      ${balance.toFixed(2)} ready
    </div>
  );
}
