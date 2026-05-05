"use client";

import type { ReactNode } from "react";
import type { Rail } from "./MockReel";

interface RailData {
  title: string;
  subtitle: ReactNode;
  cost: number;
  pnl: number;
  pct: number;
}

const PORTFOLIO_BY_RAIL: Record<Rail, RailData> = {
  meme: {
    title: "WIF",
    subtitle: (
      <span className="truncate text-xs text-neutral-500">dogwifhat</span>
    ),
    cost: 50,
    pnl: 94.2,
    pct: 188.4,
  },
  prediction: {
    title: "Will Bitcoin hit $200k by end of 2026?",
    subtitle: (
      <span className="rounded bg-[#22c55e]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#22c55e]">
        YES · 131 contracts
      </span>
    ),
    cost: 50,
    pnl: 44.0,
    pct: 88.0,
  },
  whale: {
    title: "SOL 10×",
    subtitle: (
      <span className="rounded bg-[#22c55e]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#22c55e]">
        LONG · $500
      </span>
    ),
    cost: 50,
    pnl: 110.4,
    pct: 220.8,
  },
};

export function MockPortfolio({ rails }: { rails: Rail[] }) {
  const count = rails.length;
  const totalCost = rails.reduce(
    (s, r) => s + PORTFOLIO_BY_RAIL[r].cost,
    0,
  );
  const totalPnl = rails.reduce(
    (s, r) => s + PORTFOLIO_BY_RAIL[r].pnl,
    0,
  );
  const totalPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  return (
    <div className="relative flex h-full w-full flex-col bg-black px-5 pt-[24px] pb-4 text-white">
      <style>{`
        @keyframes mock-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
          50%      { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.22); }
        }
        @keyframes mock-row-in {
          0%   { opacity: 0; transform: translateY(-12px) scale(0.98); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-3xl font-black tracking-tight">Portfolio</div>
          <div className="mt-1 text-xs text-neutral-500">
            {count === 0
              ? "No open positions"
              : `${count} open position${count === 1 ? "" : "s"}`}
          </div>
        </div>
        {count > 0 && (
          <div className="flex flex-col items-end leading-tight">
            <div className="text-2xl font-extrabold text-[#22c55e]">
              +${totalPnl.toFixed(2)}
            </div>
            <div className="text-[11px] font-semibold text-[#22c55e]">
              +{totalPct.toFixed(1)}% · all time
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-3">
        {rails.map((rail, i) => {
          const data = PORTFOLIO_BY_RAIL[rail];
          const now = data.cost + data.pnl;
          const isNewest = i === count - 1;

          return (
            <div
              key={rail}
              className="rounded-2xl border border-white/5 bg-white/[0.03] p-4"
              style={
                isNewest
                  ? {
                      animation:
                        "mock-row-in 320ms ease-out 0ms backwards, mock-glow 1.4s ease-in-out 320ms infinite",
                    }
                  : undefined
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-bold" title={data.title}>
                    {data.title}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {data.subtitle}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-neutral-500">
                    <span>Cost ${data.cost.toFixed(2)}</span>
                    <span>·</span>
                    <span>Now ${now.toFixed(2)}</span>
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-end leading-tight">
                  <div className="text-base font-bold text-[#22c55e]">
                    +${data.pnl.toFixed(2)}
                  </div>
                  <div className="text-[11px] font-semibold text-[#22c55e]">
                    +{data.pct.toFixed(1)}%
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
