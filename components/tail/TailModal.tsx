"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignMessage, useSignTransaction } from "@privy-io/react-auth/solana";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { Connection } from "@solana/web3.js";
import { useLiveMark } from "@/lib/pacifica/live-context";

const RPC =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const STAKE_CHIPS = [5, 10, 20, 50] as const;
const MIN_USDC = 5;
const MAX_USDC = 1000;

export interface TailSource {
  kind: "bot";
  botId: string;
  botName: string;
  avatarEmoji?: string;
  avatarImageUrl?: string | null;
  asset: string;
  side: "long" | "short";
  leverage: number;
  entryMark: number;
  positionId?: string;
}

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
    botId: string;
    botName: string;
    asset: string;
    side: "long" | "short";
    leverage: number;
  };
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function fmtPrice(v: number): string {
  if (v >= 1000) return `$${v.toFixed(2)}`;
  if (v >= 1) return `$${v.toFixed(3)}`;
  return `$${v.toPrecision(4)}`;
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
  const [success, setSuccess] = useState<null | OpenResponse>(null);
  const liveMark = useLiveMark(source?.asset ?? "");
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Reset modal state every time it opens with a new source.
  useEffect(() => {
    if (!open) return;
    setStake(10);
    setCustom("");
    setSubmitting(false);
    setStatus(null);
    setError(null);
    setSuccess(null);
  }, [open, source?.botId, source?.positionId]);

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
    return effectiveStake * source.leverage;
  }, [effectiveStake, source]);

  const sliceBps = 4; // Pacifica taker, conservative display
  const estFeeUsd = useMemo(
    () => (notional * sliceBps) / 10_000,
    [notional],
  );

  const stakeValid =
    effectiveStake >= MIN_USDC && effectiveStake <= MAX_USDC;

  const submit = useCallback(async () => {
    if (!source || !wallet || submitting) return;
    if (!stakeValid) {
      setError(`Stake must be between $${MIN_USDC} and $${MAX_USDC}`);
      return;
    }
    setError(null);
    setSubmitting(true);
    setStatus("Placing order…");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("not authed");

      const body = {
        botId: source.botId,
        market: source.asset,
        side: source.side,
        leverage: source.leverage,
        stakeUsdc: effectiveStake,
        walletAddress: wallet.address,
      };
      let resp = await fetch("/api/bet/bot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${resp.status}`);
      }
      const first = (await resp.json()) as
        | OnboardResponse
        | DepositResponse
        | OpenResponse;
      let result: OnboardResponse | DepositResponse | OpenResponse = first;

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
        await new Promise((resolve) => setTimeout(resolve, 1000));
      };

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
        setStatus("Placing order…");
        resp = await fetch("/api/bet/bot", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}));
          throw new Error(e.error ?? `HTTP ${resp.status}`);
        }
        result = (await resp.json()) as
          | OnboardResponse
          | DepositResponse
          | OpenResponse;
      }

      if (result.phase !== "open") {
        throw new Error(
          result.phase === "deposit"
            ? "Deposit confirmed. Pacifica balance is still settling; try again in a few seconds."
            : "Onboarding needs to be retried.",
        );
      }
      setSuccess(result);
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
    getAccessToken,
    signMessage,
    signTransaction,
  ]);

  if (!open || !source) return null;

  const sideColor =
    source.side === "long" ? "text-emerald-400" : "text-rose-400";
  const sideLabel = source.side.toUpperCase();
  const markText = liveMark ? fmtPrice(liveMark) : fmtPrice(source.entryMark);

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current && !submitting) onClose();
      }}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
    >
      <div className="w-full sm:max-w-md bg-[#0c0c0c] border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-3">
            {source.avatarImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={source.avatarImageUrl}
                alt={source.botName}
                className="w-10 h-10 rounded-full object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-xl">
                {source.avatarEmoji ?? "🤖"}
              </div>
            )}
            <div>
              <div className="text-xs uppercase tracking-widest text-white/40">
                Tail
              </div>
              <div className="text-base font-semibold text-white">
                {source.botName}
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
              {source.asset}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">
              Side
            </div>
            <div className={`text-sm font-semibold ${sideColor}`}>
              {sideLabel} {source.leverage}×
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
                Tail opened
              </div>
              <div className="text-xs text-emerald-200/80">
                {success.fill.filledAmount} {source.asset} @{" "}
                {fmtPrice(Number(success.fill.avgFillPrice))}
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

            {/* Order preview */}
            <div className="mx-5 mb-4 rounded-2xl bg-white/[0.02] border border-white/5 p-3 space-y-1.5 text-xs">
              <div className="flex justify-between text-white/60">
                <span>Notional</span>
                <span className="text-white">
                  ${notional.toFixed(2)} ({source.leverage}× of $
                  {effectiveStake.toFixed(2)})
                </span>
              </div>
              <div className="flex justify-between text-white/60">
                <span>Est. taker fee</span>
                <span className="text-white">${estFeeUsd.toFixed(3)}</span>
              </div>
              <div className="flex justify-between text-white/60">
                <span>You're following</span>
                <span className="text-white">
                  {source.botName}'s {source.asset} {sideLabel}
                </span>
              </div>
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
                disabled={submitting || !stakeValid || !wallet}
                className={`w-full py-4 rounded-2xl font-semibold text-base transition ${
                  submitting || !stakeValid || !wallet
                    ? "bg-white/10 text-white/40 cursor-not-allowed"
                    : "bg-emerald-500 text-black hover:bg-emerald-400"
                }`}
              >
                {submitting
                  ? "Working…"
                  : `Tail ${source.botName} with $${effectiveStake.toFixed(0)}`}
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
