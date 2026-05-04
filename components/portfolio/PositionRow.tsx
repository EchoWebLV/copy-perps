"use client";

import { ExternalLink } from "lucide-react";
import { CloseButton } from "./CloseButton";

export interface PortfolioPosition {
  id: string;
  type: string;
  status: string;
  ticker?: string;
  name?: string;
  tokenAddress?: string;
  amountUsdc: number;
  currentValueUsdc?: number | null;
  proceedsUsdc?: number | null;
  pnlUsdc?: number | null;
  pnlPct?: number | null;
  openTxHash?: string | null;
  closeTxHash?: string | null;
  createdAt: string;
  closedAt?: string | null;
}

const fmtUsd = (n: number | null | undefined) =>
  n == null ? "—" : `$${n >= 1000 ? n.toFixed(0) : n.toFixed(2)}`;

const fmtPct = (n: number | null | undefined) => {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
};

export function PositionRow({
  position,
  onClosed,
}: {
  position: PortfolioPosition;
  onClosed: () => void;
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

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold">
            {position.ticker ?? position.type}
          </span>
          {position.name && (
            <span className="truncate text-xs text-neutral-500">
              {position.name}
            </span>
          )}
          {isPending && (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
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
        <div className="mt-1 flex items-center gap-3 text-xs text-neutral-500">
          <span>Cost {fmtUsd(position.amountUsdc)}</span>
          <span>·</span>
          <span>Now {fmtUsd(value)}</span>
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

      <div className="flex flex-col items-end gap-1">
        <div className={`text-base font-bold ${pnlColor}`}>
          {fmtUsd(position.pnlUsdc)}
        </div>
        <div className={`text-[11px] font-semibold ${pnlColor}`}>
          {fmtPct(position.pnlPct)}
        </div>
      </div>

      {!isClosed && !isPending && !isFailed && position.type === "meme" && (
        <CloseButton betId={position.id} onClosed={onClosed} />
      )}
    </div>
  );
}
