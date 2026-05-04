import type { WhaleSignal } from "@/lib/types";
import { SignalChip } from "./SignalChip";
import { StakeButtons } from "./StakeButtons";

const fmtUsd = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(2)}`;
};

const fmtPrice = (n: number) =>
  n >= 1000 ? `$${n.toLocaleString()}` : `$${n.toFixed(2)}`;

export function WhaleCard({ signal }: { signal: WhaleSignal }) {
  return (
    <div
      className="relative flex h-full w-full snap-start flex-col px-5 pt-[60px] pb-24 text-white"
      style={{
        background: "radial-gradient(ellipse at top, #1a0a28, #050505 60%)",
      }}
    >
      <span className="absolute top-[60px] left-5 rounded-lg bg-[#7c3aed] px-2.5 py-1 text-[10px] font-bold tracking-[1px] uppercase">
        Whale opened
      </span>

      <div className="mt-14 flex items-center gap-3">
        <div
          className="h-11 w-11 shrink-0 rounded-full"
          style={{
            background:
              signal.side === "long"
                ? "linear-gradient(135deg, #7c3aed, #ec4899)"
                : "linear-gradient(135deg, #06b6d4, #22c55e)",
          }}
        />
        <div>
          <div className="text-base font-bold">{signal.walletAddress}</div>
          <div className="text-xs font-medium text-[#22c55e]">
            +{fmtUsd(signal.walletPnl30d)} PnL · 30d
          </div>
        </div>
      </div>

      <div className="mt-6 text-3xl font-extrabold tracking-tight">
        {signal.asset} {signal.leverage}× {signal.side.toUpperCase()}
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        {signal.venue} · opened {signal.openedAtRelative}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-white/[0.04] px-3 py-2.5">
          <div className="text-[10px] tracking-wider text-neutral-500 uppercase">Size</div>
          <div className="mt-0.5 text-sm font-bold">{fmtUsd(signal.size)}</div>
        </div>
        <div className="rounded-xl bg-white/[0.04] px-3 py-2.5">
          <div className="text-[10px] tracking-wider text-neutral-500 uppercase">Entry</div>
          <div className="mt-0.5 text-sm font-bold">{fmtPrice(signal.entry)}</div>
        </div>
        <div className="rounded-xl bg-white/[0.04] px-3 py-2.5">
          <div className="text-[10px] tracking-wider text-neutral-500 uppercase">Liq</div>
          <div className="mt-0.5 text-sm font-bold">{fmtPrice(signal.liquidation)}</div>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-2">
        {signal.chips.map((chip, i) => (
          <SignalChip key={i} text={chip.text} level={chip.level} />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-md bg-white/[0.06] px-2 py-1 text-[10px] text-neutral-400">
          Tail = same direction, scaled
        </span>
        <span className="rounded-md bg-white/[0.06] px-2 py-1 text-[10px] text-neutral-400">
          Fade = opposite
        </span>
      </div>

      <StakeButtons signal={signal} />
    </div>
  );
}
