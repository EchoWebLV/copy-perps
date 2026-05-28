"use client";

import { ExternalLink } from "lucide-react";
import { CloseButton } from "./CloseButton";
import { ShareButton } from "./ShareButton";

export interface PortfolioPosition {
  id: string;
  type: string;
  status: string;
  // meme
  ticker?: string;
  name?: string;
  tokenAddress?: string;
  // prediction
  question?: string;
  outcome?: "yes" | "no";
  contracts?: string;
  // perp
  asset?: string;
  side?: "long" | "short";
  leverage?: number;
  notionalUsd?: number;
  whaleAddress?: string;
  // shared
  amountUsdc: number;
  currentValueUsdc?: number | null;
  proceedsUsdc?: number | null;
  pnlUsdc?: number | null;
  pnlPct?: number | null;
  openTxHash?: string | null;
  closeTxHash?: string | null;
  createdAt: string;
  closedAt?: string | null;
  sharedAt?: string | null;
}

const fmtUsd = (n: number | null | undefined) =>
  n == null
    ? "—"
    : `${n < 0 ? "-" : ""}$${Math.abs(n) >= 1000 ? Math.abs(n).toFixed(0) : Math.abs(n).toFixed(2)}`;

const fmtPct = (n: number | null | undefined) => {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
};

function LegacyPositionMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  const valueClass =
    tone === "up"
      ? "text-[#22c55e]"
      : tone === "down"
        ? "text-[#ef4444]"
        : "text-white";

  return (
    <div className="min-w-0 rounded-2xl bg-black/20 p-3">
      <div className="text-[9px] font-black uppercase tracking-widest text-white/40">
        {label}
      </div>
      <div className={`mt-1 truncate font-mono text-[20px] font-black leading-none ${valueClass}`}>
        {value}
      </div>
    </div>
  );
}

export function PositionRow({
  position,
  onClosed,
  onShared,
}: {
  position: PortfolioPosition;
  onClosed: () => void;
  onShared?: () => void;
}) {
  const pnlColor =
    position.pnlUsdc == null
      ? "text-neutral-400"
      : position.pnlUsdc >= 0
        ? "text-[#22c55e]"
        : "text-[#ef4444]";

  const isClosed = position.status === "closed";
  const isPending = position.status === "pending";
  const isFailed = position.status === "failed";

  const value = isClosed
    ? position.proceedsUsdc
    : position.currentValueUsdc;

  const dim = isPending || isFailed;

  const isMeme = position.type === "meme";
  const isPrediction = position.type === "prediction";
  const isPerp = position.type === "perp";
  const isCopy = position.type === "copy";
  const isPerpLike = isPerp || isCopy;

  const title = isMeme
    ? (position.ticker ?? position.type)
    : isPrediction
      ? (position.question ?? "")
      : isPerpLike
        ? `${position.asset ?? position.ticker ?? "Position"} ${position.leverage ?? 1}x`
        : position.type;

  const subtitleEl = isMeme ? (
    position.name && (
      <span className="truncate text-xs text-neutral-500">
        {position.name}
      </span>
    )
  ) : isPrediction && position.outcome ? (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
        position.outcome === "yes"
          ? "bg-[#22c55e]/20 text-[#22c55e]"
          : "bg-[#ef4444]/20 text-[#ef4444]"
      }`}
    >
      {position.outcome.toUpperCase()}
      {position.contracts ? ` · ${position.contracts}` : ""}
    </span>
  ) : isPerpLike && position.side ? (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
        position.side === "long"
          ? "bg-[#22c55e]/20 text-[#22c55e]"
          : "bg-[#ef4444]/20 text-[#ef4444]"
      }`}
    >
      {position.side.toUpperCase()}
      {position.notionalUsd ? ` · $${position.notionalUsd.toFixed(0)}` : ""}
    </span>
  ) : null;

  const closeable = !isClosed && !isPending && !isFailed;
  const shareable = (isClosed || position.status === "confirmed") && !dim;
  const pnlTone =
    position.pnlUsdc == null ? undefined : position.pnlUsdc >= 0 ? "up" : "down";
  const apiBase:
    | "/api/bet/meme"
    | "/api/bet/prediction"
    | "/api/bet/perp"
    | null = isMeme
    ? "/api/bet/meme"
    : isPrediction
      ? "/api/bet/prediction"
      : isPerp
        ? "/api/bet/perp"
        : null;

  return (
    <div
      className={`rounded-[22px] border p-4 shadow-[0_18px_60px_rgba(0,0,0,0.18)] transition ${
        dim
          ? "border-white/5 bg-white/[0.015] opacity-60"
          : "border-white/10 bg-white/[0.055]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div
            className={`truncate text-[20px] font-black leading-tight ${
              dim ? "text-neutral-400" : ""
            }`}
            title={title}
          >
            {title}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {subtitleEl}
            {isPending && (
              <span className="rounded bg-neutral-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-400">
                Pending
              </span>
            )}
            {isFailed && (
              <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
                Failed
              </span>
            )}
            {isClosed && (
              <span className="rounded bg-neutral-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-400">
                Closed
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-neutral-500">
            <span>Cost {fmtUsd(position.amountUsdc)}</span>
            <span>·</span>
            <span>Current {fmtUsd(value)}</span>
            {position.openTxHash && (
              <a
                href={`https://solscan.io/tx/${position.openTxHash}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-neutral-500 hover:text-neutral-300"
                title={position.openTxHash}
              >
                <ExternalLink size={10} />
              </a>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className="flex flex-col items-end leading-tight">
            <div
              className={`text-[18px] font-black ${
                dim ? "text-neutral-500" : pnlColor
              }`}
            >
              {dim ? "—" : fmtUsd(position.pnlUsdc)}
            </div>
            <div
              className={`text-[11px] font-semibold ${
                dim ? "text-neutral-600" : pnlColor
              }`}
            >
              {dim ? "—" : fmtPct(position.pnlPct)}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {shareable && (
              <ShareButton
                betId={position.id}
                alreadyShared={!!position.sharedAt}
                onShared={onShared ?? onClosed}
              />
            )}
            {closeable && apiBase && (
              <CloseButton
                betId={position.id}
                apiBase={apiBase}
                onClosed={onClosed}
              />
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-3">
        <LegacyPositionMetric label="Current" value={fmtUsd(value)} />
        <LegacyPositionMetric label="Cost" value={fmtUsd(position.amountUsdc)} />
        <LegacyPositionMetric
          label="P/L"
          value={dim ? "—" : fmtUsd(position.pnlUsdc)}
          tone={dim ? undefined : pnlTone}
        />
      </div>
    </div>
  );
}
