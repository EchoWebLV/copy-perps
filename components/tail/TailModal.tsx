"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignMessage, useSignTransaction } from "@privy-io/react-auth/solana";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { Connection } from "@solana/web3.js";
import { useLiveMark } from "@/lib/pacifica/live-context";
import { WhaleFingerprintAvatar } from "@/components/whales/WhaleFingerprintAvatar";
import type { TailSource, WhaleTailPosition } from "./tail-types";
import {
  copyableWhalePositionsForTail,
  isWhaleTailPositionCopyable,
  whalePositionsForTail,
  whaleTailTotalNotional,
} from "./whale-tail";
import {
  whaleTailAutoCloseLabel,
  whaleTailFollowingText,
  whaleTailPositionsHeading,
  whaleTailPrimaryCta,
} from "./tail-copy-labels";

export type { TailSource, WhaleTailPosition } from "./tail-types";

const RPC =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const STAKE_CHIPS = [5, 10, 20, 50] as const;
const MIN_USDC = 5;
const MAX_USDC = 1000;

interface Props {
  open: boolean;
  onClose: () => void;
  source: TailSource | null;
}

interface OnboardResponse {
  phase: "onboard";
  alreadyOnboarded: false;
  bindMessage: string;
  bindAgentPubkey: string;
  depositTransactionB64: string;
  initialDepositUsdc: number;
}

interface DepositResponse {
  phase: "deposit";
  depositTransactionB64: string;
  initialDepositUsdc: number;
  availablePacificaUsdc?: number;
}

interface OpenResponse {
  phase: "open";
  betId: string;
  fill: {
    orderId: string;
    avgFillPrice: string;
    filledAmount: string;
    side: string;
  };
  source: {
    botId?: string;
    botName?: string;
    whaleId?: string;
    displayName?: string;
    asset: string;
    side: "long" | "short";
    leverage: number;
    autoCloseOnSourceClose?: boolean;
  };
}

interface TailSuccess {
  opens: OpenResponse[];
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function fmtPrice(v: number): string {
  if (v >= 1000) return `$${v.toFixed(2)}`;
  if (v >= 1) return `$${v.toFixed(3)}`;
  return `$${v.toPrecision(4)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TailRequestError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
    public retryAfterMs: number,
  ) {
    super(message);
    this.name = "TailRequestError";
  }
}

export function TailModal({ open, onClose, source }: Props) {
  const { getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { signMessage } = useSignMessage();
  const { signTransaction } = useSignTransaction();

  const [stake, setStake] = useState<number>(10);
  const [custom, setCustom] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<null | TailSuccess>(null);
  const [autoCloseOnSourceClose, setAutoCloseOnSourceClose] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const whaleTailPositions = useMemo(
    () =>
      source?.kind === "whale" ? whalePositionsForTail(source) : [],
    [source],
  );
  const copyableWhalePositions = useMemo(
    () =>
      source?.kind === "whale"
        ? copyableWhalePositionsForTail(source)
        : [],
    [source],
  );
  const activeWhalePosition =
    copyableWhalePositions[0] ?? whaleTailPositions[0] ?? null;
  const liveMark = useLiveMark(
    source?.kind === "whale"
      ? activeWhalePosition?.asset ?? ""
      : source?.asset ?? "",
  );

  // Reset modal state every time it opens with a new source.
  useEffect(() => {
    if (!open) return;
    setStake(10);
    setCustom("");
    setSubmitting(false);
    setStatus(null);
    setError(null);
    setSuccess(null);
    setAutoCloseOnSourceClose(source?.kind === "whale");
  }, [
    open,
    source?.kind,
    source?.kind === "bot" ? source.botId : source?.whaleId,
    source?.kind === "bot"
      ? source.positionId
      : `${source?.sourcePositionId}:${source?.positions.length ?? 0}`,
  ]);

  // Esc-to-close + body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, submitting, onClose]);

  const effectiveStake = useMemo(() => {
    const c = Number(custom);
    if (custom && Number.isFinite(c) && c > 0) return c;
    return stake;
  }, [stake, custom]);

  const notional = useMemo(() => {
    if (!source) return 0;
    if (source.kind === "whale") {
      return whaleTailTotalNotional(effectiveStake, copyableWhalePositions);
    }
    return effectiveStake * source.leverage;
  }, [copyableWhalePositions, effectiveStake, source]);

  const sliceBps = 4; // Pacifica taker, conservative display
  const estFeeUsd = useMemo(
    () => (notional * sliceBps) / 10_000,
    [notional],
  );

  const stakeValid =
    effectiveStake >= MIN_USDC && effectiveStake <= MAX_USDC;
  const hasCopyableSource =
    source?.kind !== "whale" || copyableWhalePositions.length > 0;

  const submit = useCallback(async () => {
    if (!source || !wallet || submitting) return;
    if (!stakeValid) {
      setError(`Stake must be between $${MIN_USDC} and $${MAX_USDC}`);
      return;
    }
    setError(null);
    setSubmitting(true);
    setStatus("Preparing copy…");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("not authed");

      const positionsToCopy =
        source.kind === "whale" ? copyableWhalePositions : [];
      if (source.kind === "whale" && positionsToCopy.length === 0) {
        throw new Error("No fresh whale positions are available to copy.");
      }

      const requestTail = async (copyPosition?: WhaleTailPosition) => {
        const endpoint =
          source.kind === "whale" ? "/api/bet/whale" : "/api/bet/bot";
        const body =
          source.kind === "whale"
            ? {
                positionId:
                  copyPosition?.sourcePositionId ?? source.sourcePositionId,
                stakeUsdc: effectiveStake,
                walletAddress: wallet.address,
                autoCloseOnSourceClose,
              }
            : {
                botId: source.botId,
                positionId: source.positionId,
                market: source.asset,
                side: source.side,
                leverage: source.leverage,
                stakeUsdc: effectiveStake,
                walletAddress: wallet.address,
              };
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
        if (resp.ok) {
          return (await resp.json()) as
            | OnboardResponse
            | DepositResponse
            | OpenResponse;
        }
        const e = (await resp.json().catch(() => ({}))) as {
          error?: string;
          retryable?: boolean;
          retryAfterMs?: number;
        };
        throw new TailRequestError(
          e.error ?? `HTTP ${resp.status}`,
          e.retryable === true,
          typeof e.retryAfterMs === "number" && Number.isFinite(e.retryAfterMs)
            ? e.retryAfterMs
            : 2000,
        );
      };
      const requestTailWithSettlingRetry = async (
        copyPosition?: WhaleTailPosition,
      ) => {
        const deadline = Date.now() + 30_000;
        for (;;) {
          try {
            return await requestTail(copyPosition);
          } catch (err) {
            if (
              !(err instanceof TailRequestError) ||
              !err.retryable ||
              Date.now() >= deadline
            ) {
              throw err;
            }
            setStatus("Waiting for Pacifica credit…");
            await sleep(Math.min(Math.max(err.retryAfterMs, 1000), 5000));
          }
        }
      };

      const signAndSendDeposit = async (depositTransactionB64: string) => {
        setStatus("Depositing USDC…");
        const txBytes = b64ToBytes(depositTransactionB64);
        const { signedTransaction } = (await signTransaction({
          transaction: txBytes,
          wallet,
        })) as { signedTransaction: Uint8Array };
        const conn = new Connection(RPC, "confirmed");
        const sig = await conn.sendRawTransaction(signedTransaction, {
          maxRetries: 3,
        });
        await conn.confirmTransaction(sig, "confirmed");
        await sleep(1000);
      };

      const openOne = async (
        copyPosition: WhaleTailPosition | undefined,
        index: number,
        total: number,
      ): Promise<OpenResponse> => {
        const label =
          source.kind === "whale" && copyPosition
            ? `${copyPosition.asset} ${copyPosition.side.toUpperCase()}`
            : `${source.asset} ${source.side.toUpperCase()}`;
        setStatus(
          total > 1
            ? `Copying ${index}/${total}: ${label}…`
            : `Copying ${label}…`,
        );

        const first = await requestTailWithSettlingRetry(copyPosition);
        let result: OnboardResponse | DepositResponse | OpenResponse = first;

        if (first.phase === "onboard") {
          setStatus("Authorizing trader…");
          const bindMsgBytes = new TextEncoder().encode(first.bindMessage);
          const { signature: bindSig } = (await signMessage({
            message: bindMsgBytes,
            wallet,
          })) as { signature: Uint8Array };
          const bs58 = (await import("bs58")).default;
          const bindSigB58 = bs58.encode(bindSig);
          const parsed = JSON.parse(first.bindMessage) as {
            timestamp: number;
            expiry_window: number;
          };
          const bindResp = await fetch("/api/users/me/agent/bind", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              agentPubkey: first.bindAgentPubkey,
              signatureB58: bindSigB58,
              timestamp: parsed.timestamp,
              expiryWindow: parsed.expiry_window,
              walletAddress: wallet.address,
            }),
          });
          if (!bindResp.ok) {
            const e = await bindResp.json().catch(() => ({}));
            throw new Error(`bind failed: ${e.error ?? bindResp.status}`);
          }
          await signAndSendDeposit(first.depositTransactionB64);
        }

        if (first.phase === "onboard" || first.phase === "deposit") {
          if (first.phase === "deposit") {
            await signAndSendDeposit(first.depositTransactionB64);
          }
          setStatus("Waiting for Pacifica credit…");
          result = await requestTailWithSettlingRetry(copyPosition);
        }

        if (result.phase !== "open") {
          throw new Error(
            result.phase === "deposit"
              ? "Deposit confirmed. Pacifica balance is still settling; try again in a few seconds."
              : "Onboarding needs to be retried.",
          );
        }
        return result;
      };

      const opens: OpenResponse[] = [];
      if (source.kind === "whale") {
        for (const [idx, position] of positionsToCopy.entries()) {
          opens.push(await openOne(position, idx + 1, positionsToCopy.length));
        }
      } else {
        opens.push(await openOne(undefined, 1, 1));
      }

      setSuccess({ opens });
      setStatus(null);
    } catch (err) {
      console.error("[tail] failed:", err);
      setError(String(err instanceof Error ? err.message : err).slice(0, 200));
      setStatus(null);
    } finally {
      setSubmitting(false);
    }
  }, [
    source,
    wallet,
    submitting,
    stakeValid,
    effectiveStake,
    autoCloseOnSourceClose,
    copyableWhalePositions,
    getAccessToken,
    signMessage,
    signTransaction,
  ]);

  if (!open || !source) return null;

  const isWhaleBundle =
    source.kind === "whale" && whaleTailPositions.length > 1;
  const displayPosition = activeWhalePosition;
  const displayAsset =
    source.kind === "whale"
      ? isWhaleBundle
        ? `${copyableWhalePositions.length} live`
        : displayPosition?.asset ?? source.asset
      : source.asset;
  const displaySide =
    source.kind === "whale"
      ? isWhaleBundle
        ? "MIXED"
        : (displayPosition?.side ?? source.side).toUpperCase()
      : source.side.toUpperCase();
  const displayLeverage =
    source.kind === "whale"
      ? displayPosition?.leverage ?? source.leverage
      : source.leverage;
  const sideColor =
    (displayPosition?.side ?? source.side) === "long"
      ? "text-emerald-400"
      : "text-rose-400";
  const sideLabel = source.side.toUpperCase();
  const markValue =
    liveMark ??
    (source.kind === "whale"
      ? displayPosition?.currentMark ?? source.currentMark
      : null) ??
    source.entryMark;
  const markText = fmtPrice(markValue);
  const sourceName = source.kind === "whale" ? source.displayName : source.botName;
  const sourceAvatarUrl = source.kind === "bot" ? source.avatarImageUrl : null;
  const sourceAvatarFallback = source.kind === "bot" ? source.avatarEmoji ?? "🤖" : null;
  const isSingleWhalePosition =
    source.kind === "whale" && whaleTailPositions.length === 1;

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current && !submitting) onClose();
      }}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
    >
      <div className="w-full sm:max-w-md bg-[#0c0c0c] border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden lg:mx-auto lg:max-w-[520px] lg:rounded-3xl lg:border lg:border-white/10">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-3">
            {source.kind === "whale" ? (
              <WhaleFingerprintAvatar
                sourceAccount={source.sourceAccount}
                label={sourceName}
                mood={source.stale ? "WOUNDED" : "HUNTING"}
                size={40}
                pulse={!source.stale}
              />
            ) : sourceAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sourceAvatarUrl}
                alt={sourceName}
                className="w-10 h-10 rounded-full object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-xl">
                {sourceAvatarFallback}
              </div>
            )}
            <div>
              <div className="text-xs uppercase tracking-widest text-white/40">
                {isSingleWhalePosition ? "Tail position" : "Tail"}
              </div>
              <div className="text-base font-semibold text-white">
                {sourceName}
              </div>
            </div>
          </div>
          <button
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="text-white/40 hover:text-white/80 disabled:opacity-30 text-xl leading-none px-2 py-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Position summary */}
        <div className="mx-5 mb-4 rounded-2xl bg-white/[0.03] border border-white/5 p-4 grid grid-cols-3 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">
              Asset
            </div>
            <div className="text-sm font-semibold text-white">
              {displayAsset}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">
              Side
            </div>
            <div className={`text-sm font-semibold ${sideColor}`}>
              {displaySide} {displayLeverage}×
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">
              Mark
            </div>
            <div className="text-sm font-semibold text-white">{markText}</div>
          </div>
        </div>

        {/* Success state */}
        {success ? (
          <div className="px-5 pb-6">
            <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-4 text-center">
              <div className="text-3xl mb-2">✓</div>
              <div className="text-emerald-300 font-semibold mb-1">
                {isSingleWhalePosition ? "Position copied" : "Tail opened"}
              </div>
              <div className="text-xs text-emerald-200/80">
                {success.opens.length === 1
                  ? `${success.opens[0]?.fill.filledAmount} ${success.opens[0]?.source.asset ?? source.asset} @ ${fmtPrice(Number(success.opens[0]?.fill.avgFillPrice ?? 0))}`
                  : `${success.opens.length} open positions copied`}
              </div>
            </div>
            <button
              onClick={onClose}
              className="mt-4 w-full py-3 rounded-2xl bg-white text-black font-semibold"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Stake chips */}
            <div className="px-5">
              <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">
                Stake (USDC)
              </div>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {STAKE_CHIPS.map((s) => {
                  const active = !custom && stake === s;
                  return (
                    <button
                      key={s}
                      onClick={() => {
                        setStake(s);
                        setCustom("");
                        setError(null);
                      }}
                      disabled={submitting}
                      className={`py-3 rounded-2xl font-semibold text-sm transition border ${
                        active
                          ? "bg-white text-black border-white"
                          : "bg-white/5 text-white/80 border-white/10 hover:bg-white/10"
                      }`}
                    >
                      ${s}
                    </button>
                  );
                })}
              </div>
              <div className="relative mb-3">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40">
                  $
                </span>
                <input
                  inputMode="decimal"
                  placeholder="Custom amount"
                  value={custom}
                  onChange={(e) => {
                    setCustom(e.target.value);
                    setError(null);
                  }}
                  disabled={submitting}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl pl-8 pr-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-white/30"
                />
              </div>
            </div>

            {source.kind === "whale" ? (
              <div className="mx-5 mb-4 rounded-2xl border border-white/5 bg-white/[0.02] p-3">
                <div className="mb-2 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-white/40">
                  <span>{whaleTailPositionsHeading(whaleTailPositions)}</span>
                  {isSingleWhalePosition ? null : (
                    <span>{copyableWhalePositions.length}/{whaleTailPositions.length}</span>
                  )}
                </div>
                <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                  {whaleTailPositions.map((position) => {
                    const rowMark =
                      isSingleWhalePosition &&
                      position.sourcePositionId ===
                        activeWhalePosition?.sourcePositionId
                        ? liveMark ?? position.currentMark
                        : position.currentMark;

                    const copyable = isWhaleTailPositionCopyable(position);
                    const statusLabel = position.stale
                      ? "Stale"
                      : position.copyableOnPacifica === false
                        ? "Pacifica N/A"
                        : "Will copy";

                    return (
                      <div
                        key={position.sourcePositionId}
                        className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-semibold text-white">
                            <span>{position.asset}</span>
                            <span
                              className={
                                position.side === "long"
                                  ? "text-emerald-400"
                                  : "text-rose-400"
                              }
                            >
                              {position.side.toUpperCase()}
                            </span>
                            <span className="text-white/40">
                              {position.leverage}×
                            </span>
                          </div>
                          <div className="mt-0.5 text-[10px] uppercase tracking-widest text-white/35">
                            Entry {fmtPrice(position.entryMark)}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-white/70">
                            {rowMark === null ? "Mark N/A" : fmtPrice(rowMark)}
                          </div>
                          <div
                            className={
                              copyable
                                ? "text-[10px] uppercase tracking-widest text-emerald-400"
                                : position.stale
                                ? "text-[10px] uppercase tracking-widest text-rose-400"
                                : "text-[10px] uppercase tracking-widest text-amber-300"
                            }
                          >
                            {statusLabel}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Order preview */}
            <div className="mx-5 mb-4 rounded-2xl bg-white/[0.02] border border-white/5 p-3 space-y-1.5 text-xs">
              <div className="flex justify-between text-white/60">
                <span>Notional</span>
                <span className="text-white">
                  ${notional.toFixed(2)}{" "}
                  {source.kind === "whale"
                    ? isSingleWhalePosition
                      ? `($${effectiveStake.toFixed(2)} stake)`
                      : `($${effectiveStake.toFixed(2)} per copied position)`
                    : `(${source.leverage}× of $${effectiveStake.toFixed(2)})`}
                </span>
              </div>
              <div className="flex justify-between text-white/60">
                <span>Est. taker fee</span>
                <span className="text-white">${estFeeUsd.toFixed(3)}</span>
              </div>
              <div className="flex justify-between text-white/60">
                <span>You're following</span>
                <span className="text-white">
                  {source.kind === "whale"
                    ? whaleTailFollowingText({
                        sourceName,
                        positions: whaleTailPositions,
                        copyableCount: copyableWhalePositions.length,
                      })
                    : `${sourceName}'s ${source.asset} ${sideLabel}`}
                </span>
              </div>
              {source.kind === "whale" ? (
                <label className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-[11px] font-black uppercase tracking-widest text-white/80">
                  <span>{whaleTailAutoCloseLabel(whaleTailPositions)}</span>
                  <input
                    type="checkbox"
                    checked={autoCloseOnSourceClose}
                    onChange={(e) =>
                      setAutoCloseOnSourceClose(e.target.checked)
                    }
                    disabled={submitting}
                    className="h-4 w-4 accent-emerald-400"
                  />
                </label>
              ) : null}
            </div>

            {/* Status / error */}
            {status ? (
              <div className="mx-5 mb-3 text-xs text-white/60">{status}</div>
            ) : null}
            {error ? (
              <div className="mx-5 mb-3 text-xs text-rose-400 break-words">
                {error}
              </div>
            ) : null}

            {/* CTA */}
            <div className="px-5 pb-5 pt-1">
              <button
                onClick={submit}
                disabled={submitting || !stakeValid || !wallet || !hasCopyableSource}
                className={`w-full py-4 rounded-2xl font-semibold text-base transition ${
                  submitting || !stakeValid || !wallet || !hasCopyableSource
                    ? "bg-white/10 text-white/40 cursor-not-allowed"
                    : "bg-emerald-500 text-black hover:bg-emerald-400"
                }`}
              >
                {submitting
                  ? "Working…"
                  : source.kind === "whale"
                    ? hasCopyableSource
                      ? whaleTailPrimaryCta({
                          positions: whaleTailPositions,
                          effectiveStake,
                        })
                      : "No Pacifica-copyable positions"
                    : `Tail ${sourceName} with $${effectiveStake.toFixed(0)}`}
              </button>
              {!wallet ? (
                <div className="mt-2 text-center text-xs text-white/40">
                  Connect your wallet to tail.
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
