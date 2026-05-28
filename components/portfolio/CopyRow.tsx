"use client";

import { useCallback, useState, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { formatCopySourceLabel } from "@/lib/positions/copy-row";

export interface CopyRowData {
  betId: string | null;
  sourceKind?: "tail" | "wallet";
  market: string;
  side: "long" | "short";
  leverage: number | null;
  stakeUsdc: number | null;
  leaderAddress: string | null;
  leaderUsername: string | null;
  whaleId?: string | null;
  whaleName?: string | null;
  autoCloseOnSourceClose?: boolean;
  closeReason?: "manual" | "source_closed" | "already_flat" | null;
  botId: string | null;
  botName: string | null;
  liveStatus: "open" | "not_found" | "unknown";
  entryPrice: number | null;
  markPrice: number | null;
  liquidationPrice: number | null;
  amountBase: number | null;
  marginUsd: number | null;
  marginMode: "cross" | "isolated" | null;
  notionalUsd: number | null;
  pnlUsd: number | null;
  unrealizedPnlPct: number | null;
  openedAt: string | null;
  positionUpdatedAt: string | null;
  leaderClosedAt: string | null;
}

interface Props {
  row: CopyRowData;
  onClosed: (betId: string) => void;
}

function formatUsd(value: number | null, options: { signed?: boolean } = {}) {
  if (value === null || !Number.isFinite(value)) return "-";
  const sign = value < 0 ? "-" : options.signed && value > 0 ? "+" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPrice(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  const maxDigits = value >= 1 ? 2 : value >= 0.01 ? 5 : 7;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: value >= 1 ? 2 : 0,
    maximumFractionDigits: maxDigits,
  })}`;
}

function formatAmount(value: number | null, symbol: string) {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${value.toLocaleString("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : value >= 1 ? 3 : 6,
  })} ${symbol}`;
}

function formatAge(iso: string | null) {
  if (!iso) return "-";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "-";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${remainingMinutes}m`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days < 30) return `${days}d ${remainingHours}h`;
  const months = Math.floor(days / 30);
  const remainingDays = days % 30;
  if (months < 12) return `${months}mo ${remainingDays}d`;
  const years = Math.floor(months / 12);
  return `${years}y ${months % 12}mo`;
}

function PositionHeroMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "up" | "down";
}) {
  const valueClass =
    tone === "up"
      ? "text-green-400"
      : tone === "down"
        ? "text-rose-400"
        : "text-white";

  return (
    <div className="min-w-0 rounded-2xl bg-black/20 p-3">
      <div className="text-[9px] font-black uppercase tracking-widest text-white/40">
        {label}
      </div>
      <div
        className={`mt-1 truncate font-mono text-[22px] font-black leading-none ${valueClass}`}
      >
        {value}
      </div>
      {detail && (
        <div className={`mt-1 truncate font-mono text-[12px] font-black ${valueClass}`}>
          {detail}
        </div>
      )}
    </div>
  );
}

function PositionDetailGrid({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/10 pt-3">
      {children}
    </div>
  );
}

function PositionDetailMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.035] p-3">
      <div className="text-[9px] font-black uppercase tracking-widest text-white/40">
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-[14px] font-black text-white">
        {value}
      </div>
    </div>
  );
}

export function CopyRow({ row, onClosed }: Props) {
  const { getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const handleClose = useCallback(async () => {
    if (busy) return;
    if (!row.betId && row.sourceKind !== "wallet") return;
    setBusy(true);
    setStatus("Closing...");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("not authed");
      const isWalletPosition = row.sourceKind === "wallet";
      const r = await fetch(
        isWalletPosition ? "/api/trade/perp/close" : "/api/bet/copy/close",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(
            isWalletPosition
              ? {
                  market: row.market,
                  side: row.side,
                  walletAddress: wallet?.address,
                }
              : { betId: row.betId, walletAddress: wallet?.address },
          ),
        },
      );
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.error ?? `HTTP ${r.status}`);
      }
      setStatus("Closed");
      onClosed(row.betId ?? `${row.market}:${row.side}`);
    } catch (err) {
      setStatus(`Failed: ${String(err).slice(0, 80)}`);
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(null), 4000);
    }
  }, [
    busy,
    getAccessToken,
    onClosed,
    row.betId,
    row.market,
    row.side,
    row.sourceKind,
    wallet?.address,
  ]);

  const pnlTone =
    row.pnlUsd == null ? undefined : row.pnlUsd >= 0 ? "up" : "down";
  const pnlPct =
    row.unrealizedPnlPct === null
      ? null
      : `${row.unrealizedPnlPct >= 0 ? "+" : ""}${row.unrealizedPnlPct.toFixed(1)}%`;
  const statusMeta =
    row.liveStatus === "open"
      ? {
          label: "LIVE",
          className: "border-green-400/30 bg-green-400/10 text-green-300",
          subtitle: "Current position",
        }
      : row.liveStatus === "unknown"
        ? {
            label: "SYNCING",
            className: "border-amber-300/30 bg-amber-300/10 text-amber-200",
            subtitle: "Checking wallet position",
          }
        : {
            label: "NOT OPEN",
            className: "border-rose-300/30 bg-rose-300/10 text-rose-200",
            subtitle: "No live wallet position found",
          };
  const hasStake = row.stakeUsdc !== null;
  const sourceText =
    row.sourceKind === "wallet"
      ? "wallet position"
      : `copied from ${formatCopySourceLabel(row)}`;
  const subtitleParts = [
    statusMeta.subtitle,
    hasStake ? `Stake ${formatUsd(row.stakeUsdc)}` : null,
    sourceText,
  ].filter(Boolean);
  const leverageText = row.leverage === null ? "" : ` ${Math.round(row.leverage)}x`;

  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.055] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-widest ${statusMeta.className}`}
            >
              {statusMeta.label}
            </span>
            <div className="text-[19px] font-black leading-tight text-white">
              {row.market} {row.side.toUpperCase()}
              {leverageText}
            </div>
          </div>
          <div className="mt-2 max-w-[20rem] text-[13px] font-semibold leading-snug text-white/60">
            {subtitleParts.join(" · ")}
          </div>
        </div>
        {(row.betId || row.sourceKind === "wallet") && (
          <button
            type="button"
            disabled={busy}
            onClick={handleClose}
            className="shrink-0 rounded-2xl bg-white/10 px-5 py-3 text-[14px] font-black text-white transition active:scale-95 disabled:opacity-40"
          >
            {busy ? "..." : "Close"}
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <PositionHeroMetric label="Now" value={formatPrice(row.markPrice)} />
        <PositionHeroMetric
          label="P/L"
          value={formatUsd(row.pnlUsd, { signed: true })}
          detail={pnlPct ?? undefined}
          tone={pnlTone}
        />
      </div>

      <PositionDetailGrid>
        <PositionDetailMetric label="Entry" value={formatPrice(row.entryPrice)} />
        <PositionDetailMetric
          label="Size"
          value={formatAmount(row.amountBase, row.market)}
        />
        <PositionDetailMetric label="Notional" value={formatUsd(row.notionalUsd)} />
        <PositionDetailMetric label="Liq" value={formatPrice(row.liquidationPrice)} />
        <PositionDetailMetric label="Margin" value={formatUsd(row.marginUsd)} />
        <PositionDetailMetric
          label="Mode"
          value={row.marginMode ? row.marginMode.toUpperCase() : "-"}
        />
      </PositionDetailGrid>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-widest text-white/45">
        {row.sourceKind !== "wallet" && (
          <span>
            {row.autoCloseOnSourceClose ? "AUTO-CLOSE ON" : "MANUAL CLOSE"}
          </span>
        )}
        {row.marginMode && <span>{row.marginMode} margin</span>}
        {row.openedAt && <span>OPENED {formatAge(row.openedAt)} AGO</span>}
        {row.positionUpdatedAt && (
          <span>SYNCED {formatAge(row.positionUpdatedAt)} AGO</span>
        )}
      </div>

      <div>
        {row.closeReason === "source_closed" && (
          <div className="mt-1 text-xs text-amber-300">
            Closed after whale exited
          </div>
        )}
        {row.closeReason === "already_flat" && (
          <div className="mt-1 text-xs text-amber-300">
            Already flat when whale exited
          </div>
        )}
        {row.leaderClosedAt && !row.closeReason && (
          <div className="mt-1 text-xs text-amber-300">
            Leader exited. Close yours to settle.
          </div>
        )}
      </div>
      {status && <div className="mt-2 text-xs text-white/70">{status}</div>}
    </div>
  );
}
