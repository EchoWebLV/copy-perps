import type { PredictionSignal } from "@/lib/types";
import { SignalChip } from "./SignalChip";
import { StakeButtons } from "./StakeButtons";

const fmtUsd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${(n / 1_000).toFixed(0)}k`;

export function PredictionCard({ signal }: { signal: PredictionSignal }) {
  const yesCents = Math.round(signal.yesProbability * 100);
  const noCents = 100 - yesCents;

  return (
    <div
      className="relative flex h-full w-full snap-start flex-col px-5 pt-[60px] pb-24 text-white"
      style={{
        background: "radial-gradient(ellipse at top, #0a1428, #050505 60%)",
      }}
    >
      <span className="absolute top-[60px] left-5 rounded-lg bg-[#2563eb] px-2.5 py-1 text-[10px] font-bold tracking-[1px] uppercase">
        Polymarket
      </span>

      <div className="mt-14 text-2xl font-bold leading-tight">{signal.question}</div>
      <div className="mt-3 text-xs text-neutral-500">
        Resolves {signal.resolveDate} · {fmtUsd(signal.volume24h)} volume
      </div>

      <div className="mt-6 flex gap-2.5">
        <div className="flex-1 rounded-2xl bg-white/[0.04] p-4">
          <div className="text-[11px] tracking-[1px] text-neutral-500 uppercase">YES</div>
          <div className="mt-1 text-3xl font-extrabold text-[#22c55e]">{yesCents}¢</div>
        </div>
        <div className="flex-1 rounded-2xl bg-white/[0.04] p-4">
          <div className="text-[11px] tracking-[1px] text-neutral-500 uppercase">NO</div>
          <div className="mt-1 text-3xl font-extrabold text-[#ef4444]">{noCents}¢</div>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-2">
        {signal.chips.map((chip, i) => (
          <SignalChip key={i} text={chip.text} level={chip.level} />
        ))}
      </div>

      <StakeButtons signal={signal} />
    </div>
  );
}
