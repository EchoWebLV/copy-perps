"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  useSignAndSendTransaction,
  useSignMessage,
} from "@privy-io/react-auth/solana";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { Connection } from "@solana/web3.js";
import { Minus, Plus } from "lucide-react";
import {
  flashTradeModeForLeverage,
  maxFlashLeverageForMarket,
} from "@/lib/flash/markets";
import { useLiveMark } from "@/lib/pacifica/live-context";
import { formatPriceUsd, formatUsd } from "@/components/whales/whale-money";
import { WhaleFingerprintAvatar } from "@/components/whales/WhaleFingerprintAvatar";
import type { TailSource, WhaleTailPosition } from "./tail-types";
import {
  isWhaleTailPositionMarketCopyable,
  isWhaleTailPositionCopyable,
  whalePositionsForTail,
  whaleTailTotalNotional,
} from "./whale-tail";
import {
  whaleTailFollowingText,
  whaleTailPositionsHeading,
  whaleTailPrimaryCta,
} from "./tail-copy-labels";
import {
  formatTailSigningError,
  sendDepositWithSponsorFallback,
} from "./deposit-signing";
import { clampTailLeverage, tailLeverageBounds } from "./tail-leverage";
import {
  PacificaCreditWaitTimeoutError,
  retryTailRequestWithCreditWait,
} from "./tail-settling-retry";

export type { TailSource, WhaleTailPosition } from "./tail-types";

const RPC =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const STAKE_CHIPS = [1, 5, 10, 50] as const;
const MIN_USDC = 1;
const MAX_USDC = 1000;
const TAIL_TRADE_SETTLING_AUTO_WAIT_MS = 20_000;

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
    detachedFromSource?: boolean;
  };
}

interface FlashSignResponse {
  phase: "sign";
  venue: "flash";
  betId?: string;
  transactionB64: string;
  quote: {
    amountUsd?: number;
    notionalUsd?: number;
    leverage?: number;
    entryPriceUsd?: number;
    feesUsd?: number;
  };
  position: {
    symbol: string;
    side: "long" | "short";
    entryPriceUsd: number;
    sizeUsd: number;
  };
  trade: {
    market: string;
    side: "long" | "short";
    stakeUsdc: number;
    leverage: number;
  };
}

interface TailSuccess {
  opens: OpenResponse[];
}

type TailRequestResponse =
  | OnboardResponse
  | DepositResponse
  | OpenResponse
  | FlashSignResponse;

function retryFundedDepositPhase(response: TailRequestResponse) {
  if (response.phase !== "deposit") return null;
  return {
    message: "Trading balance is still updating.",
    retryAfterMs: 2000,
  };
}

type TailPreflightState =
  | { checking: true; error: null; canOpen: null; mode: null }
  | {
      checking: false;
      error: string | null;
      canOpen: boolean | null;
      mode: "live" | "snapshot" | null;
    };

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const fmtPrice = formatPriceUsd;

/** Rough isolated-margin liquidation mark: entry ± entry/leverage. */
function approxLiqPrice(
  entry: number,
  side: "long" | "short",
  leverage: number,
): number | null {
  if (!Number.isFinite(entry) || entry <= 0 || leverage <= 1) return null;
  return side === "long"
    ? entry * (1 - 1 / leverage)
    : entry * (1 + 1 / leverage);
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

function flashSignResponseToOpen(
  response: FlashSignResponse,
  signature: string,
  source: TailSource,
): OpenResponse {
  const entryPrice =
    response.quote.entryPriceUsd ?? response.position.entryPriceUsd ?? 0;
  const sizeUsd = response.position.sizeUsd ?? response.quote.notionalUsd ?? 0;
  return {
    phase: "open",
    betId: response.betId ?? `flash:${signature}`,
    fill: {
      orderId: signature,
      avgFillPrice: String(entryPrice),
      filledAmount:
        Number.isFinite(sizeUsd) && sizeUsd > 0
          ? `$${sizeUsd.toFixed(2)} notional`
          : "Flash position",
      side: response.trade.side,
    },
    source:
      source.kind === "whale"
        ? {
            whaleId: source.whaleId,
            displayName: source.displayName,
            asset: response.trade.market,
            side: response.trade.side,
            leverage: response.trade.leverage,
            autoCloseOnSourceClose: false,
          }
        : {
            botId: source.botId,
            botName: source.botName,
            asset: response.trade.market,
            side: response.trade.side,
            leverage: response.trade.leverage,
          },
  };
}

function tailSuccessSummary(open: OpenResponse, fallbackAsset: string): string {
  const asset = open.source.asset ?? fallbackAsset;
  const price = fmtPrice(Number(open.fill.avgFillPrice || 0));
  if (open.betId.startsWith("flash:")) {
    return `${open.fill.filledAmount} ${open.source.side.toUpperCase()} ${asset} @ ${price}`;
  }
  return `${open.fill.filledAmount} ${asset} @ ${price}`;
}

export function TailModal({ open, onClose, source }: Props) {
  const { getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { signMessage } = useSignMessage();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const [stake, setStake] = useState<number>(1);
  const [custom, setCustom] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<null | TailSuccess>(null);
  const [whaleLeverage, setWhaleLeverage] = useState(1);
  const [now, setNow] = useState(() => Date.now());
  const [preflight, setPreflight] = useState<TailPreflightState>({
    checking: false,
    error: null,
    canOpen: null,
    mode: null,
  });
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const whaleTailPositions = useMemo(
    () =>
      source?.kind === "whale" ? whalePositionsForTail(source) : [],
    [source],
  );
  const executableWhalePositions = useMemo(
    () =>
      source?.kind === "whale"
        ? whaleTailPositions.filter(
            (position) => isWhaleTailPositionMarketCopyable(position),
          )
        : [],
    [source?.kind, whaleTailPositions],
  );
  const activeWhalePosition =
    executableWhalePositions[0] ?? whaleTailPositions[0] ?? null;
  const isSingleWhalePosition =
    source?.kind === "whale" && whaleTailPositions.length === 1;
  const sourceWhaleLeverage =
    source?.kind === "whale"
      ? Math.max(1, activeWhalePosition?.leverage ?? source.leverage)
      : 1;
  const activeFlashMaxLeverage =
    source?.kind === "whale"
      ? maxFlashLeverageForMarket(activeWhalePosition?.asset ?? source.asset)
      : null;
  const whaleLeverageBounds = tailLeverageBounds({
    sourceLeverage: sourceWhaleLeverage,
    marketMaxLeverage:
      source?.kind === "whale"
        ? activeFlashMaxLeverage ?? activeWhalePosition?.maxLeverage ?? source.maxLeverage
        : null,
  });
  const maxWhaleLeverage = whaleLeverageBounds.maxLeverage;
  const boundedWhaleLeverage = clampTailLeverage(
    whaleLeverage,
    maxWhaleLeverage,
  );
  const showWhaleLeverageControl =
    source?.kind === "whale" && isSingleWhalePosition;
  const copyLeverage = showWhaleLeverageControl
    ? boundedWhaleLeverage
    : undefined;
  const liveMark = useLiveMark(
    source?.kind === "whale"
      ? activeWhalePosition?.asset ?? ""
      : source?.asset ?? "",
  );

  // Reset modal state every time it opens with a new source.
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    setStake(1);
    setCustom("");
    setSubmitting(false);
    setStatus(null);
    setError(null);
    setSuccess(null);
    setPreflight({
      checking: false,
      error: null,
      canOpen: null,
      mode: null,
    });
    setWhaleLeverage(
      source?.kind === "whale"
        ? tailLeverageBounds({
            sourceLeverage: source.positions[0]?.leverage ?? source.leverage,
            marketMaxLeverage:
              maxFlashLeverageForMarket(
                source.positions[0]?.asset ?? source.asset,
              ) ??
              source.positions[0]?.maxLeverage ??
              source.maxLeverage,
          }).initialLeverage
        : 1,
    );
  }, [
    open,
    source?.kind,
    source?.kind === "bot" ? source.botId : source?.whaleId,
    source?.kind === "bot"
      ? source.positionId
      : `${source?.sourcePositionId}:${source?.positions.length ?? 0}`,
  ]);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [open]);

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
      if (showWhaleLeverageControl) {
        return effectiveStake * boundedWhaleLeverage;
      }
      return whaleTailTotalNotional(effectiveStake, executableWhalePositions);
    }
    return effectiveStake * source.leverage;
  }, [
    boundedWhaleLeverage,
    effectiveStake,
    executableWhalePositions,
    showWhaleLeverageControl,
    source,
  ]);

  const sliceBps = 4; // Flash taker, conservative display
  const estFeeUsd = useMemo(
    () => (notional * sliceBps) / 10_000,
    [notional],
  );

  const stakeValid =
    effectiveStake >= MIN_USDC && effectiveStake <= MAX_USDC;
  const hasCopyableSource =
    source?.kind !== "whale" || executableWhalePositions.length > 0;
  const preflightBlocked = preflight.canOpen === false;
  const activeWhalePositionLive =
    source?.kind === "whale" && activeWhalePosition
      ? isWhaleTailPositionCopyable(activeWhalePosition, now)
      : false;
  useEffect(() => {
    if (!open || source?.kind !== "whale" || !wallet || !hasCopyableSource) {
      setPreflight({
        checking: false,
        error: null,
        canOpen: null,
        mode: null,
      });
      return;
    }
    setPreflight({
      checking: false,
      error: null,
      canOpen: true,
      mode: activeWhalePositionLive ? "live" : "snapshot",
    });
  }, [
    activeWhalePositionLive,
    hasCopyableSource,
    open,
    source?.kind,
    wallet,
  ]);

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
        source.kind === "whale" ? executableWhalePositions : [];
      if (source.kind === "whale" && positionsToCopy.length === 0) {
        throw new Error("No executable whale positions are available to copy.");
      }
      if (source.kind === "whale" && preflightBlocked) {
        throw new Error(preflight.error ?? "This tail is not available.");
      }

      const requestTail = async (copyPosition?: WhaleTailPosition) => {
        const flashMarket =
          source.kind === "whale"
            ? copyPosition?.asset ?? source.asset
            : source.asset;
        const flashSide =
          source.kind === "whale"
            ? copyPosition?.side ?? source.side
            : source.side;
        const flashLeverage =
          source.kind === "whale"
            ? copyLeverage ?? copyPosition?.leverage ?? source.leverage
            : source.leverage;
        const body = {
          market: flashMarket,
          side: flashSide,
          stakeUsdc: effectiveStake,
          leverage: flashLeverage,
          mode: flashTradeModeForLeverage(flashMarket, flashLeverage) ?? "standard",
          walletAddress: wallet.address,
          tail:
            source.kind === "whale"
              ? {
                  sourceKind: "whale",
                  whaleId: source.whaleId,
                  sourceName: source.displayName,
                  sourcePositionId:
                    copyPosition?.sourcePositionId ?? source.sourcePositionId,
                }
              : {
                  sourceKind: "bot",
                  botId: source.botId,
                  sourceName: source.botName,
                  sourcePositionId: source.positionId ?? null,
                },
        };
        const resp = await fetch("/api/flash/perp", {
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
            | OpenResponse
            | FlashSignResponse;
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
        retryDepositPhase = false,
      ) => {
        return retryTailRequestWithCreditWait({
          request: () => requestTail(copyPosition),
          sleep,
          maxWaitMs: TAIL_TRADE_SETTLING_AUTO_WAIT_MS,
          onRetry: () => {
            setStatus("Opening trade when balance updates…");
          },
          retryResult: retryDepositPhase ? retryFundedDepositPhase : undefined,
        });
      };

      const signAndSendDeposit = async (
        depositTransactionB64: string,
        statusText = "Signing transaction…",
      ) => {
        setStatus(statusText);
        const txBytes = b64ToBytes(depositTransactionB64);
        const { signature } = await sendDepositWithSponsorFallback({
          transaction: txBytes,
          wallet,
          signAndSendTransaction,
          preferSponsored: false,
          onSponsorFallback: (err) => {
            console.warn("[tail] sponsored deposit send failed:", err);
            setStatus(statusText);
          },
        });
        const bs58 = (await import("bs58")).default;
        const sig =
          typeof signature === "string" ? signature : bs58.encode(signature);
        const conn = new Connection(RPC, "confirmed");
        await conn.confirmTransaction(sig, "confirmed");
        await sleep(1000);
        return sig;
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
        let result: TailRequestResponse = first;

        if (first.phase === "sign") {
          const signature = await signAndSendDeposit(
            first.transactionB64,
            "Signing Flash trade…",
          );
          if (first.betId) {
            await fetch("/api/flash/perp/confirm", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                betId: first.betId,
                signature,
              }),
            })
              .then((resp) => {
                if (!resp.ok) {
                  console.warn(
                    "[tail] flash confirm postback HTTP",
                    resp.status,
                  );
                }
              })
              .catch((err) =>
                console.warn("[tail] flash confirm postback failed:", err),
              );
          }
          setStatus("Opened on Flash");
          return flashSignResponseToOpen(first, signature, source);
        }

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
          await signAndSendDeposit(
            first.depositTransactionB64,
            "Funding trade…",
          );
        }

        if (first.phase === "onboard" || first.phase === "deposit") {
          if (first.phase === "deposit") {
            await signAndSendDeposit(
              first.depositTransactionB64,
              "Funding trade…",
            );
          }
          setStatus("Updating trading balance…");
          result = await requestTailWithSettlingRetry(copyPosition, true);
        }

        if (result.phase !== "open") {
          throw new Error(
            result.phase === "deposit"
              ? "Funds are still settling. Try again in a few seconds."
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
      if (!(err instanceof PacificaCreditWaitTimeoutError)) {
        console.error("[tail] failed:", err);
      }
      setError(formatTailSigningError(err).slice(0, 220));
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
    copyLeverage,
    executableWhalePositions,
    getAccessToken,
    preflight.error,
    preflightBlocked,
    signMessage,
    signAndSendTransaction,
  ]);

  if (!open || !source) return null;

  const isWhaleBundle =
    source.kind === "whale" && whaleTailPositions.length > 1;
  // Honest bundle summary: mixed-asset tails have no single side/leverage/
  // mark, so describe the mix instead of pretending.
  const bundleLongCount = executableWhalePositions.filter(
    (p) => p.side === "long",
  ).length;
  const bundleShortCount = executableWhalePositions.filter(
    (p) => p.side === "short",
  ).length;
  const bundleLeverages = executableWhalePositions.map((p) => p.leverage);
  const bundleLevMin = bundleLeverages.length
    ? Math.min(...bundleLeverages)
    : 0;
  const bundleLevMax = bundleLeverages.length
    ? Math.max(...bundleLeverages)
    : 0;
  const displayPosition = activeWhalePosition;
  const displayAsset =
    source.kind === "whale"
      ? isWhaleBundle
        ? `${executableWhalePositions.length} ready`
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
      ? showWhaleLeverageControl
        ? boundedWhaleLeverage
        : displayPosition?.leverage ?? source.leverage
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
  const sourceName =
    source.kind === "whale" ? source.displayName : source.botName;
  const sourceAvatarUrl = source.kind === "bot" ? source.avatarImageUrl : null;
  const sourceAvatarFallback =
    source.kind === "bot" ? source.avatarEmoji ?? "🤖" : null;
  const submitDisabled =
    submitting ||
    !stakeValid ||
    !wallet ||
    !hasCopyableSource ||
    preflight.checking ||
    preflightBlocked;

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

        {/* Position summary. Bundles get mix stats — a single side/lev/mark
            would be fiction across different assets. */}
        {isWhaleBundle ? (
          <div className="mx-5 mb-4 rounded-2xl bg-white/[0.03] border border-white/5 p-4 grid grid-cols-3 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">
                Positions
              </div>
              <div className="text-sm font-semibold text-white">
                {executableWhalePositions.length}/{whaleTailPositions.length} ready
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">
                Mix
              </div>
              <div className="text-sm font-semibold">
                <span className="text-emerald-400">{bundleLongCount}L</span>
                <span className="text-white/30"> / </span>
                <span className="text-rose-400">{bundleShortCount}S</span>
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">
                Leverage
              </div>
              <div className="text-sm font-semibold text-white">
                {bundleLevMin === bundleLevMax
                  ? `${bundleLevMax}×`
                  : `${bundleLevMin}–${bundleLevMax}×`}
              </div>
            </div>
          </div>
        ) : (
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
            {/* Bot sources: surface the source entry (and approx liq) the
                whale position rows already show — the Mark cell alone would
                hide the entry→mark gap once a live mark arrives. */}
            {source.kind === "bot" ? (
              <div className="col-span-3 border-t border-white/5 pt-2 text-[10px] uppercase tracking-widest text-white/35">
                Entry {fmtPrice(source.entryMark)}
                {(() => {
                  const liq = approxLiqPrice(
                    source.entryMark,
                    source.side,
                    source.leverage,
                  );
                  return liq === null ? null : ` · Liq ≈ ${fmtPrice(liq)}`;
                })()}
              </div>
            ) : null}
          </div>
        )}

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
                  ? success.opens[0]
                    ? tailSuccessSummary(success.opens[0], source.asset)
                    : "Position copied"
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

            {showWhaleLeverageControl ? (
              <div className="mx-5 mb-4 rounded-2xl border border-white/5 bg-white/[0.02] p-3">
                <div className="mb-2 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-white/40">
                  <span>Tail leverage</span>
                  <span className="text-white">{boundedWhaleLeverage}x</span>
                </div>
                <div className="mb-3 grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
                  <button
                    type="button"
                    aria-label="Decrease leverage"
                    disabled={submitting || boundedWhaleLeverage <= 1}
                    onClick={() => {
                      setWhaleLeverage((value) =>
                        clampTailLeverage(value - 1, maxWhaleLeverage),
                      );
                      setError(null);
                    }}
                    className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white transition disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <Minus size={16} strokeWidth={3} />
                  </button>
                  <div className="text-center text-2xl font-black tabular-nums text-white">
                    {boundedWhaleLeverage}x
                  </div>
                  <button
                    type="button"
                    aria-label="Increase leverage"
                    disabled={
                      submitting || boundedWhaleLeverage >= maxWhaleLeverage
                    }
                    onClick={() => {
                      setWhaleLeverage((value) =>
                        clampTailLeverage(value + 1, maxWhaleLeverage),
                      );
                      setError(null);
                    }}
                    className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white transition disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <Plus size={16} strokeWidth={3} />
                  </button>
                </div>
                <input
                  type="range"
                  min={1}
                  max={maxWhaleLeverage}
                  step={1}
                  value={boundedWhaleLeverage}
                  onChange={(e) => {
                    setWhaleLeverage(Number(e.target.value));
                    setError(null);
                  }}
                  disabled={submitting || maxWhaleLeverage <= 1}
                  aria-label="Tail leverage"
                  className="w-full accent-emerald-400"
                />
                <div className="mt-2 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-white/35">
                  <span>1x</span>
                  <span>Source {sourceWhaleLeverage}x</span>
                  <span>Max {maxWhaleLeverage}x</span>
                </div>
              </div>
            ) : null}

            {source.kind === "whale" ? (
              <div className="mx-5 mb-4 rounded-2xl border border-white/5 bg-white/[0.02] p-3">
                <div className="mb-2 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-white/40">
                  <span>{whaleTailPositionsHeading(whaleTailPositions)}</span>
                  {isSingleWhalePosition ? null : (
                    <span>
                      {executableWhalePositions.length}/{whaleTailPositions.length}
                    </span>
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

                    const liveCopyable = isWhaleTailPositionCopyable(
                      position,
                      now,
                    );
                    const executable =
                      isWhaleTailPositionMarketCopyable(position);
                    const statusLabel = !executable
                      ? "Not available"
                      : liveCopyable
                        ? "Live copy"
                        : "Snapshot copy";

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
                            {(() => {
                              const liq = approxLiqPrice(
                                position.entryMark,
                                position.side,
                                position.leverage,
                              );
                              return liq === null
                                ? null
                                : ` · Liq ≈ ${fmtPrice(liq)}`;
                            })()}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-white/70">
                            {rowMark === null ? "Mark N/A" : fmtPrice(rowMark)}
                          </div>
                          <div
                            className={
                              !executable
                                ? "text-[10px] uppercase tracking-widest text-white/30"
                                : liveCopyable
                                  ? "text-[10px] uppercase tracking-widest text-emerald-400"
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
                  {formatUsd(notional)}{" "}
                  {source.kind === "whale"
                    ? isSingleWhalePosition
                      ? `(${boundedWhaleLeverage}× of $${effectiveStake.toFixed(2)})`
                      : `($${effectiveStake.toFixed(2)} per copied position)`
                    : `(${source.leverage}× of $${effectiveStake.toFixed(2)})`}
                </span>
              </div>
              <div className="flex justify-between text-white/60">
                <span>Est. taker fee</span>
                <span className="text-white">${estFeeUsd.toFixed(3)}</span>
              </div>
              <div className="flex justify-between text-white/60">
                <span>Liq. buffer</span>
                <span className="text-white">
                  {source.kind === "whale" && !isSingleWhalePosition
                    ? bundleLevMax > 0
                      ? `~${(100 / bundleLevMax).toFixed(1)}%–${(
                          100 / Math.max(1, bundleLevMin)
                        ).toFixed(1)}% adverse move`
                      : "—"
                    : `~${(100 / Math.max(1, displayLeverage)).toFixed(1)}% adverse move`}
                </span>
              </div>
              <div className="flex justify-between text-white/60">
                <span>You're following</span>
                <span className="text-white">
                  {source.kind === "whale"
                    ? whaleTailFollowingText({
                        sourceName,
                        positions: whaleTailPositions,
                        copyableCount: executableWhalePositions.length,
                      })
                    : `${sourceName}'s ${source.asset} ${sideLabel}`}
                </span>
              </div>
            </div>

            {/* Status / error */}
            {status || preflight.checking ? (
              <div className="mx-5 mb-3 text-xs text-white/60">
                {status ?? "Checking trade availability..."}
              </div>
            ) : null}
            {error ? (
              <div className="mx-5 mb-3 text-xs text-rose-400 break-words">
                {error}
              </div>
            ) : preflight.error ? (
              <div className="mx-5 mb-3 text-xs text-rose-400 break-words">
                {preflight.error}
              </div>
            ) : null}

            {/* CTA */}
            <div className="px-5 pb-5 pt-1">
              <button
                onClick={submit}
                disabled={submitDisabled}
                className={`w-full py-4 rounded-2xl font-semibold text-base transition ${
                  submitDisabled
                    ? "bg-white/10 text-white/40 cursor-not-allowed"
                    : "bg-emerald-500 text-black hover:bg-emerald-400"
                }`}
              >
                {submitting
                  ? "Working..."
                  : preflight.checking
                    ? "Checking..."
                    : preflightBlocked
                      ? "Close existing tail first"
                      : source.kind === "whale"
                        ? hasCopyableSource
                          ? whaleTailPrimaryCta({
                              positions: whaleTailPositions,
                              effectiveStake,
                            })
                          : "No copyable positions"
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
