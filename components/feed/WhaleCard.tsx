"use client";

import type { WhaleSignal } from "@/lib/types";
import { SignalChip } from "./SignalChip";
import { StakeButtons } from "./StakeButtons";
import { perpAssetImage } from "@/lib/feed/perp-image";
import { BookmarkButton } from "@/components/watchlist/BookmarkButton";
import { useAnalyze } from "./AnalyzeProvider";
import { usePerpPrice } from "@/lib/feed/use-perp-price";
import { usePulseOnChange } from "@/lib/feed/use-pulse-on-change";
import { useCoinFlip } from "@/lib/feed/use-coin-flip";

const fmtUsd = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(2)}`;
};

const fmtPrice = (n: number) =>
  n >= 1000 ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `$${n.toFixed(2)}`;

const fmtSignedUsd = (n: number) => {
  const sign = n >= 0 ? "+" : "−";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
};

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

export function WhaleCard({
  signal,
  flipNonce = 0,
}: {
  signal: WhaleSignal;
  flipNonce?: number;
}) {
  const coinIcon = perpAssetImage(signal.asset);
  const { open: openAnalyze } = useAnalyze();
  const markPrice = usePerpPrice(signal.asset);
  const botBtnRef = useCoinFlip(flipNonce);

  // Live PnL on the whale's position. Long pnl = (mark - entry) / entry × size,
  // short flips the sign. Returns null while waiting for the first Pyth tick.
  const pnlUsd =
    markPrice != null && signal.entry > 0
      ? signal.side === "long"
        ? ((markPrice - signal.entry) / signal.entry) * signal.size
        : ((signal.entry - markPrice) / signal.entry) * signal.size
      : null;
  const pnlPct =
    pnlUsd != null && signal.size > 0
      ? (pnlUsd / signal.size) * signal.leverage * 100
      : null;

  // Distance from current price to the liquidation level, expressed as
  // a percentage of current price. Long → price has to fall this much;
  // short → price has to rise this much. Use mark when we have it,
  // otherwise fall back to entry so the chip is still meaningful.
  const referencePrice = markPrice ?? signal.entry;
  const liqDistancePct =
    referencePrice > 0 && signal.liquidation > 0
      ? Math.abs((referencePrice - signal.liquidation) / referencePrice) * 100
      : null;

  // Pulse animations on each tick. Mark price pulses raw value; PnL
  // pulses on signed dollar value so going from +$10 to +$11 fires
  // up-pulse, +$11 to +$9 fires down-pulse.
  const markPulse = usePulseOnChange(markPrice);
  const pnlPulse = usePulseOnChange(pnlUsd);

  return (
    <div className="relative flex h-full w-full flex-col px-5 pt-[60px] pb-24 text-white">
      <div className="absolute top-[58px] left-5 z-10 flex items-center gap-2">
        <span className="rounded-lg bg-[#7c3aed] px-2.5 py-1 text-[10px] font-bold tracking-[1px] uppercase">
          Whale
        </span>
        <BookmarkButton signal={signal} />
      </div>

      <button
        ref={botBtnRef}
        type="button"
        onClick={() => openAnalyze(signal)}
        aria-label="Ask Gwak about this whale position"
        className="absolute top-[56px] right-5 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full ring-1 ring-white/10 transition active:scale-95 hover:ring-emerald-300/50"
        style={
          coinIcon
            ? { background: "rgba(255,255,255,0.05)" }
            : {
                background:
                  signal.side === "long"
                    ? "linear-gradient(135deg, #7c3aed, #ec4899)"
                    : "linear-gradient(135deg, #06b6d4, #22c55e)",
              }
        }
      >
        {coinIcon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coinIcon}
            alt={signal.asset}
            className="h-full w-full object-contain p-1.5"
            loading="lazy"
          />
        ) : (
          <span className="text-[11px] font-black tracking-tight">
            {signal.asset.slice(0, 4)}
          </span>
        )}
      </button>

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

      <div className="mt-4 rounded-2xl bg-white/[0.04] p-3">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[10px] tracking-wider text-neutral-500 uppercase">
              Mark · live
            </div>
            <div
              className={`mt-0.5 text-2xl font-extrabold ${
                markPulse === "up"
                  ? "pulse-up"
                  : markPulse === "down"
                    ? "pulse-down"
                    : ""
              }`}
            >
              {markPrice != null ? fmtPrice(markPrice) : "—"}
            </div>
          </div>
          {pnlUsd != null && pnlPct != null ? (
            <div className="text-right">
              <div
                className={`text-base font-extrabold ${
                  pnlPulse === "up"
                    ? "pulse-up"
                    : pnlPulse === "down"
                      ? "pulse-down"
                      : ""
                }`}
                style={{ color: pnlUsd >= 0 ? "#22c55e" : "#ef4444" }}
              >
                {fmtSignedUsd(pnlUsd)}
              </div>
              <div
                className="text-[11px] font-bold"
                style={{ color: pnlUsd >= 0 ? "#22c55e" : "#ef4444" }}
              >
                {pnlPct >= 0 ? "+" : ""}
                {pnlPct.toFixed(1)}%
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-neutral-500">whale pnl</div>
          )}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[10px] tracking-wider text-neutral-500 uppercase">Size</div>
            <div className="mt-0.5 text-xs font-bold">{fmtUsd(signal.size)}</div>
          </div>
          <div>
            <div className="text-[10px] tracking-wider text-neutral-500 uppercase">Entry</div>
            <div className="mt-0.5 text-xs font-bold">{fmtPrice(signal.entry)}</div>
          </div>
          <div>
            <div className="text-[10px] tracking-wider text-neutral-500 uppercase">
              {liqDistancePct != null ? "to liq" : "Liq"}
            </div>
            <div
              className="mt-0.5 text-xs font-bold"
              style={
                liqDistancePct != null && liqDistancePct < 10
                  ? { color: "#f87171" }
                  : undefined
              }
            >
              {liqDistancePct != null
                ? `${liqDistancePct.toFixed(1)}%`
                : fmtPrice(signal.liquidation)}
            </div>
          </div>
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
