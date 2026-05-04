import type { MemeSignal } from "@/lib/types";
import { SignalChip } from "./SignalChip";
import { StakeButtons } from "./StakeButtons";

function fmtMarketCap(n: number | undefined): string {
  if (!n || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function MemeCard({ signal }: { signal: MemeSignal }) {
  // Tolerate rows still on the legacy `change1hPct` shape until the next
  // cron run rewrites them.
  const change =
    signal.change24hPct ??
    (signal as unknown as { change1hPct?: number }).change1hPct ??
    0;
  const up = change >= 0;
  const stroke = up ? "#22c55e" : "#ef4444";

  return (
    <div className="relative flex h-full w-full flex-col px-5 pt-[60px] pb-24 text-white">
      <span className="absolute top-[60px] left-5 rounded-lg bg-[#ff5e3a] px-2.5 py-1 text-[10px] font-bold tracking-[1px] uppercase">
        Coin
      </span>

      {signal.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={signal.imageUrl}
          alt={signal.ticker}
          className="absolute top-[56px] right-5 h-14 w-14 rounded-full bg-white/5 object-cover ring-1 ring-white/10"
          loading="lazy"
        />
      ) : null}

      <div className="mt-[60px] text-[44px] font-black tracking-tight leading-none">
        {signal.ticker}
      </div>
      <div className="mt-1 text-sm text-neutral-500">{signal.name} · {signal.chain}</div>

      <div className="mt-7">
        <div className="text-[11px] font-bold uppercase tracking-[1.5px] text-neutral-500">
          Market cap
        </div>
        <div className="mt-1 text-4xl font-extrabold">
          {fmtMarketCap(signal.marketCap)}
        </div>
        <div
          className="mt-1 text-base font-semibold"
          style={{ color: up ? "#22c55e" : "#ef4444" }}
        >
          {up ? "+" : ""}
          {change.toFixed(1)}% · 24h
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
