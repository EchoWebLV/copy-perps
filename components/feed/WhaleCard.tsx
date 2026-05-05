import type { WhaleSignal } from "@/lib/types";
import { SignalChip } from "./SignalChip";
import { StakeButtons } from "./StakeButtons";
import { perpAssetImage } from "@/lib/feed/perp-image";
import { BookmarkButton } from "@/components/watchlist/BookmarkButton";

const fmtUsd = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(2)}`;
};

const fmtPrice = (n: number) =>
  n >= 1000 ? `$${n.toLocaleString()}` : `$${n.toFixed(2)}`;

function fmtRelativeOpened(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just opened";
  const min = ms / 60_000;
  if (min < 1) return "just opened";
  if (min < 60) return `${Math.round(min)}m ago`;
  const hr = min / 60;
  if (hr < 24) return `${hr.toFixed(1)}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export function WhaleCard({ signal }: { signal: WhaleSignal }) {
  const coinIcon = perpAssetImage(signal.asset);

  return (
    <div className="relative flex h-full w-full flex-col px-5 pt-[60px] pb-24 text-white">
      <span className="absolute top-[60px] right-5 rounded-lg bg-[#7c3aed] px-2.5 py-1 text-[10px] font-bold tracking-[1px] uppercase">
        Whale open
      </span>

      <div className="absolute top-[100px] right-5 z-10">
        <BookmarkButton signal={signal} />
      </div>

      {coinIcon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coinIcon}
          alt={signal.asset}
          className="absolute top-[56px] left-5 h-14 w-14 rounded-full bg-white/5 object-contain p-1.5 ring-1 ring-white/10"
          loading="lazy"
        />
      ) : (
        <div
          className="absolute top-[56px] left-5 flex h-14 w-14 items-center justify-center rounded-full ring-1 ring-white/10"
          style={{
            background:
              signal.side === "long"
                ? "linear-gradient(135deg, #7c3aed, #ec4899)"
                : "linear-gradient(135deg, #06b6d4, #22c55e)",
          }}
        >
          <span className="text-[11px] font-black tracking-tight">
            {signal.asset.slice(0, 4)}
          </span>
        </div>
      )}

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
          <div className="text-xs font-medium text-neutral-400">
            Account · {fmtUsd(signal.walletAccountValue)}
          </div>
        </div>
      </div>

      <div className="mt-6 text-3xl font-extrabold tracking-tight">
        {signal.asset} {signal.leverage}× {signal.side.toUpperCase()}
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        {signal.venue} · {signal.scaledIn ? "added " : "opened "}
        {fmtRelativeOpened(signal.openedAt)}
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
