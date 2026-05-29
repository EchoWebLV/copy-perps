"use client";

import { useCallback, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import { Connection } from "@solana/web3.js";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { sendDepositWithSponsorFallback } from "@/components/tail/deposit-signing";
import { formatCopySourceLabel } from "@/lib/positions/copy-row";

const RPC =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ?? "https://api.mainnet-beta.solana.com";

export interface CopyRowData {
  betId: string | null;
  venue?: "pacifica" | "flash";
  sourceKind?: "tail" | "wallet";
  market: string;
  side: "long" | "short";
  leverage: number | null;
  stakeUsdc: number | null;
  openFeeUsd?: number | null;
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
  pricedAt: string | null;
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

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function CompactPositionMetric({
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
    <div className="min-w-0 rounded-xl bg-black/20 px-2.5 py-2">
      <div className="text-[9px] font-black uppercase tracking-widest text-white/40">
        {label}
      </div>
      <div
        className={`mt-1 truncate font-mono text-[14px] font-black leading-none ${valueClass}`}
      >
        {value}
      </div>
      {detail && (
        <div className={`mt-1 truncate font-mono text-[10px] font-black ${valueClass}`}>
          {detail}
        </div>
      )}
    </div>
  );
}

export function CopyRow({ row, onClosed }: Props) {
  const { getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const signAndSendFlashClose = useCallback(
    async (transactionB64: string) => {
      if (!wallet) throw new Error("wallet not ready");
      setStatus("Signing close...");
      const { signature } = await sendDepositWithSponsorFallback({
        transaction: b64ToBytes(transactionB64),
        wallet,
        signAndSendTransaction,
        preferSponsored: false,
      });
      const bs58 = (await import("bs58")).default;
      const signatureText =
        typeof signature === "string" ? signature : bs58.encode(signature);
      setStatus("Confirming close...");
      const conn = new Connection(RPC, "confirmed");
      await conn.confirmTransaction(signatureText, "confirmed");
    },
    [signAndSendTransaction, wallet],
  );

  const handleClose = useCallback(async () => {
    if (busy) return;
    if (!row.betId && row.sourceKind !== "wallet") return;
    setBusy(true);
    setStatus("Closing...");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("not authed");
      const isWalletPosition = row.sourceKind === "wallet";
      const isFlashPosition = row.venue === "flash";
      const r = await fetch(
        isFlashPosition
          ? "/api/flash/perp/close"
          : isWalletPosition
            ? "/api/trade/perp/close"
            : "/api/bet/copy/close",
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
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      if (isFlashPosition) {
        if (typeof body.transactionB64 !== "string") {
          throw new Error("Flash close transaction missing");
        }
        await signAndSendFlashClose(body.transactionB64);
      }
      setStatus("Closed");
      onClosed(row.betId ?? `${row.venue ?? "pacifica"}:${row.market}:${row.side}`);
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
    row.venue,
    signAndSendFlashClose,
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
        }
      : row.liveStatus === "unknown"
        ? {
            label: row.markPrice == null ? "CHECKING" : "DATA DELAYED",
            className: "border-amber-300/30 bg-amber-300/10 text-amber-200",
          }
        : {
            label: "NOT OPEN",
            className: "border-rose-300/30 bg-rose-300/10 text-rose-200",
          };
  const hasStake = row.stakeUsdc !== null;
  const sourceText =
    row.venue === "flash"
      ? "Flash"
      : row.sourceKind === "wallet"
      ? "Wallet"
      : formatCopySourceLabel(row);
  const subtitleParts = [
    hasStake ? `Stake ${formatUsd(row.stakeUsdc)}` : null,
    sourceText,
  ].filter(Boolean);
  const leverageText = row.leverage === null ? "" : ` ${Math.round(row.leverage)}x`;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest ${statusMeta.className}`}
            >
              {statusMeta.label}
            </span>
            <div className="truncate text-[15px] font-black leading-tight text-white">
              {row.market} {row.side.toUpperCase()}
              {leverageText}
            </div>
          </div>
          <div className="mt-1 max-w-[18rem] truncate text-[11px] font-semibold text-white/55">
            {subtitleParts.join(" · ")}
          </div>
        </div>
        {(row.betId || row.sourceKind === "wallet") && (
          <button
            type="button"
            disabled={busy}
            onClick={handleClose}
            className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-[12px] font-black text-white transition active:scale-95 disabled:opacity-40"
          >
            {busy ? "..." : "Close"}
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <CompactPositionMetric
          label="P/L"
          value={formatUsd(row.pnlUsd, { signed: true })}
          detail={pnlPct ?? undefined}
          tone={pnlTone}
        />
        <CompactPositionMetric label="Now" value={formatPrice(row.markPrice)} />
        <CompactPositionMetric label="Notional" value={formatUsd(row.notionalUsd)} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-white/38">
        {row.openedAt && <span>OPENED {formatAge(row.openedAt)} AGO</span>}
        {row.pricedAt && (
          <span>PRICED {formatAge(row.pricedAt)} AGO</span>
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
