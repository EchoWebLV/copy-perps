"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import {
  useSignAndSendTransaction,
  useSignMessage,
} from "@privy-io/react-auth/solana";
import { Connection } from "@solana/web3.js";
import { ArrowDownRight, ArrowUpRight, Loader2, WalletCards } from "lucide-react";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { sendDepositWithSponsorFallback, formatTailSigningError } from "@/components/tail/deposit-signing";
import {
  PacificaCreditWaitTimeoutError,
  retryTailRequestWithCreditWait,
} from "@/components/tail/tail-settling-retry";
import {
  ACCENT,
  BG,
  DIM,
  FAINT,
  FG,
  FONT_DISPLAY,
  GREEN,
  PANEL,
  PANEL_2,
  RED,
  Stamp,
} from "@/components/v2/ui";

const RPC =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const MARKETS = ["BTC", "ETH", "SOL"] as const;
const STAKES = [5, 10, 25, 50] as const;
const LEVERAGES = [5, 10, 20, 50] as const;

type Market = (typeof MARKETS)[number];
type TradeSide = "long" | "short";

interface OnboardResponse {
  phase: "onboard";
  bindMessage: string;
  bindAgentPubkey: string;
  depositTransactionB64: string;
}

interface DepositResponse {
  phase: "deposit";
  depositTransactionB64: string;
}

interface OpenResponse {
  phase: "open";
  fill: {
    orderId: string;
    avgFillPrice: string;
    filledAmount: string;
    side: string;
  };
  trade: {
    market: string;
    side: TradeSide;
    leverage: number;
    stakeUsdc: number;
  };
}

type TradeResponse = OnboardResponse | DepositResponse | OpenResponse;

class TradeRequestError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
    public retryAfterMs: number,
  ) {
    super(message);
    this.name = "TradeRequestError";
  }
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmtUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function fmtFillPrice(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  if (n >= 1000) return `$${n.toFixed(2)}`;
  if (n >= 1) return `$${n.toFixed(3)}`;
  return `$${n.toPrecision(4)}`;
}

export function FastPerpsGame() {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { signMessage } = useSignMessage();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const [market, setMarket] = useState<Market>("SOL");
  const [side, setSide] = useState<TradeSide>("long");
  const [stake, setStake] = useState(10);
  const [leverage, setLeverage] = useState(10);
  const [customStake, setCustomStake] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<OpenResponse | null>(null);

  const effectiveStake = useMemo(() => {
    const parsed = Number(customStake);
    return customStake && Number.isFinite(parsed) && parsed > 0 ? parsed : stake;
  }, [customStake, stake]);
  const notional = effectiveStake * leverage;
  const sideColor = side === "long" ? GREEN : RED;
  const readyToTrade = ready && authenticated && wallet && !busy;

  const requestTrade = useCallback(async (): Promise<TradeResponse> => {
    const token = await getAccessToken();
    if (!token) throw new Error("not authed");
    const resp = await fetch("/api/trade/perp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        market,
        side,
        stakeUsdc: effectiveStake,
        leverage,
        walletAddress: wallet?.address,
      }),
    });
    if (resp.ok) return (await resp.json()) as TradeResponse;
    const body = (await resp.json().catch(() => ({}))) as {
      error?: string;
      retryable?: boolean;
      retryAfterMs?: number;
    };
    throw new TradeRequestError(
      body.error ?? `HTTP ${resp.status}`,
      body.retryable === true,
      typeof body.retryAfterMs === "number" ? body.retryAfterMs : 2000,
    );
  }, [effectiveStake, getAccessToken, leverage, market, side, wallet?.address]);

  const signAndSendDeposit = useCallback(
    async (depositTransactionB64: string) => {
      if (!wallet) throw new Error("wallet not ready");
      setStatus("Funding trade...");
      const { signature } = await sendDepositWithSponsorFallback({
        transaction: b64ToBytes(depositTransactionB64),
        wallet,
        signAndSendTransaction,
        preferSponsored: false,
      });
      const bs58 = (await import("bs58")).default;
      const signatureText =
        typeof signature === "string" ? signature : bs58.encode(signature);
      const conn = new Connection(RPC, "confirmed");
      await conn.confirmTransaction(signatureText, "confirmed");
      await sleep(1000);
    },
    [signAndSendTransaction, wallet],
  );

  const openTrade = useCallback(async () => {
    if (!readyToTrade) return;
    if (effectiveStake < 5 || effectiveStake > 1000) {
      setError("Stake must be between $5 and $1000");
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);
    setStatus("Preparing trade...");
    try {
      const requestWithCreditWait = () =>
        retryTailRequestWithCreditWait({
          request: requestTrade,
          sleep,
          onRetry: ({ remainingMs }) => {
            setStatus(
              `Updating trading balance (${Math.ceil(remainingMs / 1000)}s)...`,
            );
          },
        });

      let result = await requestWithCreditWait();

      if (result.phase === "onboard") {
        if (!wallet) throw new Error("wallet not ready");
        const token = await getAccessToken();
        if (!token) throw new Error("not authed");
        setStatus("Authorizing trader...");
        const bindMsgBytes = new TextEncoder().encode(result.bindMessage);
        const { signature: bindSig } = (await signMessage({
          message: bindMsgBytes,
          wallet,
        })) as { signature: Uint8Array };
        const bs58 = (await import("bs58")).default;
        const parsed = JSON.parse(result.bindMessage) as {
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
            agentPubkey: result.bindAgentPubkey,
            signatureB58: bs58.encode(bindSig),
            timestamp: parsed.timestamp,
            expiryWindow: parsed.expiry_window,
            walletAddress: wallet.address,
          }),
        });
        if (!bindResp.ok) {
          const body = await bindResp.json().catch(() => ({}));
          throw new Error(`bind failed: ${body.error ?? bindResp.status}`);
        }
        await signAndSendDeposit(result.depositTransactionB64);
        setStatus("Opening trade...");
        result = await requestWithCreditWait();
      }

      if (result.phase === "deposit") {
        await signAndSendDeposit(result.depositTransactionB64);
        setStatus("Opening trade...");
        result = await requestWithCreditWait();
      }

      if (result.phase !== "open") {
        throw new Error("Trade setup needs to be retried.");
      }
      setSuccess(result);
      setStatus(null);
    } catch (err) {
      if (!(err instanceof PacificaCreditWaitTimeoutError)) {
        console.error("[trade] failed:", err);
      }
      setError(formatTailSigningError(err).slice(0, 220));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [
    effectiveStake,
    getAccessToken,
    readyToTrade,
    requestTrade,
    signAndSendDeposit,
    signMessage,
    wallet,
  ]);

  return (
    <div
      className="mx-auto flex h-full max-w-md flex-col overflow-hidden px-5 pt-5 lg:max-w-5xl lg:px-8"
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <Stamp label="Trade" value="Fast Perps" />
          <div className="mt-2 text-[42px] font-black uppercase leading-none">
            {market}
          </div>
        </div>
        <Link
          href="/portfolio"
          className="flex h-11 w-11 items-center justify-center rounded-2xl transition active:scale-95"
          style={{ background: PANEL, color: FG, border: `1px solid ${FAINT}` }}
          aria-label="Open positions"
        >
          <WalletCards size={18} strokeWidth={2.8} />
        </Link>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        {MARKETS.map((nextMarket) => {
          const active = market === nextMarket;
          return (
            <button
              key={nextMarket}
              type="button"
              onClick={() => {
                setMarket(nextMarket);
                setError(null);
                setSuccess(null);
              }}
              className="rounded-2xl px-3 py-3 text-[13px] font-black uppercase tracking-widest transition active:scale-[0.97]"
              style={{
                background: active ? ACCENT : PANEL,
                color: active ? BG : FG,
                border: `1px solid ${active ? ACCENT : FAINT}`,
              }}
            >
              {nextMarket}
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {(["long", "short"] as const).map((nextSide) => {
          const active = side === nextSide;
          const color = nextSide === "long" ? GREEN : RED;
          const Icon = nextSide === "long" ? ArrowUpRight : ArrowDownRight;
          return (
            <button
              key={nextSide}
              type="button"
              onClick={() => {
                setSide(nextSide);
                setError(null);
                setSuccess(null);
              }}
              className="flex items-center justify-center gap-2 rounded-2xl px-4 py-4 text-[14px] font-black uppercase tracking-widest transition active:scale-[0.97]"
              style={{
                background: active ? `${color}22` : PANEL,
                color: active ? color : FG,
                border: `1px solid ${active ? color : FAINT}`,
              }}
            >
              <Icon size={17} strokeWidth={3} />
              {nextSide}
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-2xl p-3" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
        <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
          Stake
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {STAKES.map((nextStake) => {
            const active = !customStake && stake === nextStake;
            return (
              <button
                key={nextStake}
                type="button"
                onClick={() => {
                  setStake(nextStake);
                  setCustomStake("");
                  setError(null);
                  setSuccess(null);
                }}
                className="rounded-xl px-2 py-3 text-[13px] font-black transition active:scale-[0.97]"
                style={{
                  background: active ? FG : PANEL_2,
                  color: active ? BG : FG,
                  border: `1px solid ${active ? FG : FAINT}`,
                }}
              >
                ${nextStake}
              </button>
            );
          })}
        </div>
        <input
          inputMode="decimal"
          value={customStake}
          onChange={(e) => {
            setCustomStake(e.target.value);
            setError(null);
            setSuccess(null);
          }}
          placeholder="Custom USDC"
          className="mt-2 w-full rounded-xl border bg-black/20 px-4 py-3 text-[14px] font-black text-white outline-none placeholder:text-white/30"
          style={{ borderColor: FAINT }}
        />
      </div>

      <div className="mt-4 rounded-2xl p-3" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
            Leverage
          </div>
          <div className="text-[22px] font-black" style={{ color: sideColor }}>
            {leverage}x
          </div>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {LEVERAGES.map((nextLeverage) => {
            const active = leverage === nextLeverage;
            return (
              <button
                key={nextLeverage}
                type="button"
                onClick={() => {
                  setLeverage(nextLeverage);
                  setError(null);
                  setSuccess(null);
                }}
                className="rounded-xl px-2 py-3 text-[13px] font-black transition active:scale-[0.97]"
                style={{
                  background: active ? sideColor : PANEL_2,
                  color: active ? BG : FG,
                  border: `1px solid ${active ? sideColor : FAINT}`,
                }}
              >
                {nextLeverage}x
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <PreviewMetric label="Stake" value={fmtUsd(effectiveStake)} />
        <PreviewMetric label="Notional" value={fmtUsd(notional)} color={sideColor} />
      </div>

      {success && (
        <div
          className="mt-4 rounded-2xl p-4"
          style={{ background: `${GREEN}18`, border: `1px solid ${GREEN}45` }}
        >
          <div className="text-[11px] font-black uppercase tracking-widest" style={{ color: GREEN }}>
            Opened
          </div>
          <div className="mt-1 text-[18px] font-black">
            {success.trade.market} {success.trade.side.toUpperCase()} {success.trade.leverage}x
          </div>
          <div className="mt-1 text-[12px] font-black uppercase tracking-widest" style={{ color: DIM }}>
            {success.fill.filledAmount} filled at {fmtFillPrice(success.fill.avgFillPrice)}
          </div>
          <Link
            href="/portfolio"
            className="mt-3 inline-flex rounded-xl px-4 py-2 text-[12px] font-black uppercase tracking-widest"
            style={{ background: FG, color: BG }}
          >
            Positions
          </Link>
        </div>
      )}

      {(status || error) && (
        <div
          className="mt-4 rounded-2xl px-4 py-3 text-[12px] font-black uppercase tracking-widest"
          style={{
            background: error ? `${RED}18` : PANEL,
            color: error ? RED : DIM,
            border: `1px solid ${error ? `${RED}45` : FAINT}`,
          }}
        >
          {error ?? status}
        </div>
      )}

      <div className="mt-auto pb-28 pt-5 lg:pb-8">
        {!ready ? (
          <button
            type="button"
            disabled
            className="flex w-full items-center justify-center rounded-2xl py-4 text-[15px] font-black uppercase tracking-widest"
            style={{ background: PANEL, color: DIM }}
          >
            Loading
          </button>
        ) : !authenticated ? (
          <button
            type="button"
            onClick={login}
            className="flex w-full items-center justify-center rounded-2xl py-4 text-[15px] font-black uppercase tracking-widest transition active:scale-[0.97]"
            style={{ background: ACCENT, color: BG }}
          >
            Log in to trade
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void openTrade()}
            disabled={!readyToTrade}
            className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-[15px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:cursor-not-allowed"
            style={{
              background: readyToTrade ? sideColor : PANEL,
              color: readyToTrade ? BG : DIM,
              boxShadow: readyToTrade
                ? `0 4px 0 ${sideColor}99, inset 0 -2px 0 rgba(0,0,0,0.15)`
                : "none",
            }}
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {busy ? "Working" : `${side.toUpperCase()} ${market}`}
          </button>
        )}
      </div>
    </div>
  );
}

function PreviewMetric({
  label,
  value,
  color = FG,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="rounded-2xl p-3" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
      <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
        {label}
      </div>
      <div className="mt-1 text-[24px] font-black leading-none tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
