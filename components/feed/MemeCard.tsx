import type { MemeSignal } from "@/lib/types";
import { SignalChip } from "./SignalChip";
import { StakeButtons } from "./StakeButtons";

export function MemeCard({ signal }: { signal: MemeSignal }) {
  const up = signal.change1hPct >= 0;
  const stroke = up ? "#22c55e" : "#ef4444";

  return (
    <div className="relative flex h-full w-full flex-col px-5 pt-[60px] pb-24 text-white">
      <span className="absolute top-[60px] left-5 rounded-lg bg-[#ff5e3a] px-2.5 py-1 text-[10px] font-bold tracking-[1px] uppercase">
        Meme
      </span>

      <div className="mt-[60px] text-[44px] font-black tracking-tight leading-none">
        {signal.ticker}
      </div>
      <div className="mt-1 text-sm text-neutral-500">{signal.name} · {signal.chain}</div>

      <div className="mt-7">
        <div className="text-4xl font-extrabold">
          ${signal.price < 1 ? signal.price.toFixed(4) : signal.price.toFixed(2)}
        </div>
        <div
          className="mt-1 text-base font-semibold"
          style={{ color: up ? "#22c55e" : "#ef4444" }}
        >
          {up ? "+" : ""}
          {signal.change1hPct.toFixed(1)}% · last hour
        </div>
      </div>

      <div
        className="relative mt-5 h-[90px] rounded"
        style={{
          background: up
            ? "linear-gradient(180deg, rgba(34,197,94,0.15), transparent)"
            : "linear-gradient(180deg, rgba(239,68,68,0.15), transparent)",
        }}
      >
        <svg viewBox="0 0 300 90" preserveAspectRatio="none" className="h-full w-full">
          <path d={signal.sparklinePath} fill="none" stroke={stroke} strokeWidth={2.5} />
        </svg>
      </div>

      <div className="mt-5 flex flex-col gap-2">
        {signal.chips.map((chip, i) => (
          <SignalChip key={i} text={chip.text} level={chip.level} />
        ))}
      </div>

      <StakeButtons signal={signal} />
    </div>
  );
}
