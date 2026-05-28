"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import { Connection } from "@solana/web3.js";
import { ArrowDownRight, ArrowUpRight, Loader2, WalletCards } from "lucide-react";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import {
  formatTailSigningError,
  sendDepositWithSponsorFallback,
} from "@/components/tail/deposit-signing";
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
const STAKES = [1, 2, 5, 10] as const;
const LEVERAGES = [20, 50, 100] as const;
const FLASH_MIN_NOTIONAL_USD = 10;
const FLASH_MIN_NOTIONAL_TEXT = "Flash minimum position is $10 notional";
const MAX_GRAPH_POINTS = 120;
const GRAPH_SAMPLE_MS = 80;

type Market = (typeof MARKETS)[number];
type TradeSide = "long" | "short";

interface FlashPosition {
  symbol: Market;
  side: TradeSide;
  positionPubkey: string;
  marketAccount: string;
  entryPriceUsd: number;
  markPriceUsd?: number;
  sizeUsd: number;
  collateralUsd: number;
  collateralSymbol?: string;
  leverage?: number;
  liquidationPriceUsd?: number;
  pnlUsd?: number;
  receiveUsd?: number;
  isProfitable?: boolean;
  openTime: number;
}

interface FlashOpenResponse {
  phase: "sign";
  venue: "flash";
  transactionB64: string;
  quote: {
    amountUsd?: number;
    notionalUsd?: number;
    leverage?: number;
    entryPriceUsd?: number;
    liquidationPriceUsd?: number;
  };
  position: FlashPosition;
  trade: {
    market: Market;
    side: TradeSide;
    leverage: number;
    stakeUsdc: number;
  };
}

interface FlashCloseResponse {
  phase: "sign-close";
  venue: "flash";
  transactionB64: string;
  position: FlashPosition;
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function fmtUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function fmtPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) return `$${value.toFixed(0)}`;
  if (Math.abs(value) >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toPrecision(4)}`;
}

function valueForPosition(position: FlashPosition | null): number {
  if (!position) return 0;
  if (position.receiveUsd != null && Number.isFinite(position.receiveUsd)) {
    return Math.max(0, position.receiveUsd);
  }
  return Math.max(0, position.collateralUsd + (position.pnlUsd ?? 0));
}

function pnlForPosition(position: FlashPosition | null): number {
  if (!position) return 0;
  return valueForPosition(position) - position.collateralUsd;
}

function roiForPosition(position: FlashPosition | null): number {
  if (!position || position.collateralUsd <= 0) return 0;
  return (pnlForPosition(position) / position.collateralUsd) * 100;
}

function liquidationMoveForPosition(position: FlashPosition | null): number | null {
  const mark = position?.markPriceUsd ?? position?.entryPriceUsd;
  const liquidation = position?.liquidationPriceUsd;
  if (!position || mark == null || mark <= 0 || liquidation == null) return null;
  return ((liquidation - mark) / mark) * 100;
}

export function FastPerpsGame() {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const [market, setMarket] = useState<Market>("SOL");
  const [side, setSide] = useState<TradeSide>("long");
  const [stake, setStake] = useState(1);
  const [leverage, setLeverage] = useState(20);
  const [customStake, setCustomStake] = useState("");
  const [positions, setPositions] = useState<FlashPosition[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveStake = useMemo(() => {
    const parsed = Number(customStake);
    return customStake && Number.isFinite(parsed) && parsed > 0 ? parsed : stake;
  }, [customStake, stake]);
  const notional = effectiveStake * leverage;
  const selectedPosition = useMemo(
    () => positions.find((p) => p.symbol === market && p.side === side) ?? null,
    [market, positions, side],
  );
  const graphValue = valueForPosition(selectedPosition);
  const livePnl = pnlForPosition(selectedPosition);
  const liveRoi = roiForPosition(selectedPosition);
  const liquidationMove = liquidationMoveForPosition(selectedPosition);
  const sideColor = side === "long" ? GREEN : RED;
  const graphColor = !selectedPosition
    ? ACCENT
    : livePnl >= 0
      ? GREEN
      : RED;
  const readyToTrade = Boolean(ready && authenticated && wallet && !busy);
  const tradeAllowed = notional >= FLASH_MIN_NOTIONAL_USD;

  const loadPositions = useCallback(async () => {
    if (!authenticated || !wallet?.address) {
      setPositions([]);
      return;
    }
    const token = await getAccessToken();
    if (!token) return;
    const resp = await fetch("/api/flash/perp/positions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ walletAddress: wallet.address }),
    });
    if (!resp.ok) return;
    const body = (await resp.json()) as { positions?: FlashPosition[] };
    setPositions(body.positions ?? []);
  }, [authenticated, getAccessToken, wallet?.address]);

  useEffect(() => {
    void loadPositions();
  }, [loadPositions]);

  useEffect(() => {
    if (!authenticated || !wallet?.address) return;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void loadPositions();
    }, 2500);
    return () => clearInterval(id);
  }, [authenticated, loadPositions, wallet?.address]);

  const signAndSendFlashTransaction = useCallback(
    async (transactionB64: string) => {
      if (!wallet) throw new Error("wallet not ready");
      const { signature } = await sendDepositWithSponsorFallback({
        transaction: b64ToBytes(transactionB64),
        wallet,
        signAndSendTransaction,
        preferSponsored: false,
      });
      const bs58 = (await import("bs58")).default;
      const signatureText =
        typeof signature === "string" ? signature : bs58.encode(signature);
      const conn = new Connection(RPC, "confirmed");
      await conn.confirmTransaction(signatureText, "confirmed");
    },
    [signAndSendTransaction, wallet],
  );

  const upsertPosition = useCallback((position: FlashPosition) => {
    setPositions((current) => [
      ...current.filter((p) => p.positionPubkey !== position.positionPubkey),
      position,
    ]);
  }, []);

  const requestOpen = useCallback(async (): Promise<FlashOpenResponse> => {
    const token = await getAccessToken();
    if (!token) throw new Error("not authed");
    const resp = await fetch("/api/flash/perp", {
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
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error ?? `HTTP ${resp.status}`);
    return body as FlashOpenResponse;
  }, [effectiveStake, getAccessToken, leverage, market, side, wallet?.address]);

  const requestClose = useCallback(async (): Promise<FlashCloseResponse> => {
    const token = await getAccessToken();
    if (!token) throw new Error("not authed");
    const resp = await fetch("/api/flash/perp/close", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        market,
        side,
        walletAddress: wallet?.address,
      }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error ?? `HTTP ${resp.status}`);
    return body as FlashCloseResponse;
  }, [getAccessToken, market, side, wallet?.address]);

  const openLive = useCallback(async () => {
    if (!readyToTrade || selectedPosition) return;
    if (!tradeAllowed) {
      setError(FLASH_MIN_NOTIONAL_TEXT);
      return;
    }
    setBusy(true);
    setError(null);
    setStatus("Preparing Flash trade...");
    try {
      const result = await requestOpen();
      setStatus("Signing Flash transaction...");
      await signAndSendFlashTransaction(result.transactionB64);
      upsertPosition(result.position);
      setStatus("Opened on Flash");
      await loadPositions();
    } catch (err) {
      console.error("[flash trade] open failed:", err);
      setError(formatTailSigningError(err).slice(0, 220));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [
    loadPositions,
    readyToTrade,
    requestOpen,
    selectedPosition,
    signAndSendFlashTransaction,
    tradeAllowed,
    upsertPosition,
  ]);

  const closeLive = useCallback(async () => {
    if (!readyToTrade || !selectedPosition) return;
    setBusy(true);
    setError(null);
    setStatus("Preparing Flash close...");
    try {
      const result = await requestClose();
      setStatus("Signing Flash close...");
      await signAndSendFlashTransaction(result.transactionB64);
      setPositions((current) =>
        current.filter((p) => p.positionPubkey !== selectedPosition.positionPubkey),
      );
      setStatus("Closed on Flash");
      await loadPositions();
    } catch (err) {
      console.error("[flash trade] close failed:", err);
      setError(formatTailSigningError(err).slice(0, 220));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [
    loadPositions,
    readyToTrade,
    requestClose,
    selectedPosition,
    signAndSendFlashTransaction,
  ]);

  return (
    <div
      className="mx-auto flex h-full min-h-0 max-w-md flex-col overflow-hidden px-4 pt-3 pb-[calc(88px+env(safe-area-inset-bottom))] lg:max-w-5xl lg:px-8 lg:py-8"
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <Stamp label="Trade" value="FLASH PERPS" />
          <div className="mt-1 text-[34px] font-black uppercase leading-none">
            {market}
          </div>
          <div className="mt-0.5 text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
            USDC collateral · user-signed
          </div>
        </div>
        <Link
          href="/portfolio"
          className="flex h-9 w-9 items-center justify-center rounded-xl transition active:scale-95"
          style={{ background: PANEL, color: FG, border: `1px solid ${FAINT}` }}
          aria-label="Open positions"
        >
          <WalletCards size={16} strokeWidth={2.8} />
        </Link>
      </div>

      {positions.length > 0 && (
        <div className="no-scrollbar mt-2 flex max-h-12 gap-2 overflow-x-auto overflow-y-hidden">
          {positions.map((position) => {
            const active =
              position.symbol === market && position.side === side;
            const pnl = pnlForPosition(position);
            return (
              <button
                key={position.positionPubkey}
                type="button"
                onClick={() => {
                  setMarket(position.symbol);
                  setSide(position.side);
                  setError(null);
                }}
                className="flex min-w-[168px] items-center justify-between rounded-xl px-3 py-1.5 text-left transition active:scale-[0.98]"
                style={{
                  background: active ? PANEL_2 : PANEL,
                  border: `1px solid ${active ? ACCENT : FAINT}`,
                }}
              >
                <div>
                  <div className="text-[11px] font-black uppercase tracking-widest">
                    {position.symbol} {position.side}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] font-black" style={{ color: DIM }}>
                    {(position.leverage ?? 0).toFixed(0)}x · stake {fmtUsd(position.collateralUsd)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[11px] font-black">
                    {fmtUsd(valueForPosition(position))}
                  </div>
                  <div
                    className="mt-0.5 font-mono text-[10px] font-black"
                    style={{ color: pnl >= 0 ? GREEN : RED }}
                  >
                    {pnl >= 0 ? "+" : ""}
                    {fmtUsd(pnl)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2">
        {MARKETS.map((nextMarket) => {
          const active = market === nextMarket;
          return (
            <button
              key={nextMarket}
              type="button"
              onClick={() => {
                setMarket(nextMarket);
                setError(null);
              }}
              className="rounded-xl px-3 py-2 text-[12px] font-black uppercase tracking-widest transition active:scale-[0.97]"
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

      <div className="mt-2 grid grid-cols-2 gap-2">
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
              }}
              className="flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-black uppercase tracking-widest transition active:scale-[0.97]"
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

      {selectedPosition && (
        <div className="mt-3 h-[180px] overflow-hidden rounded-2xl" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
          <LivePerpGraph
            value={graphValue}
            entryValue={selectedPosition.collateralUsd}
            color={graphColor}
            activeKey={selectedPosition.positionPubkey}
          />
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <PreviewMetric
          label={selectedPosition ? "Value" : "Stake"}
          value={fmtUsd(selectedPosition ? graphValue : effectiveStake)}
          color={selectedPosition ? graphColor : FG}
        />
        <PreviewMetric
          label={selectedPosition ? "P/L" : "Notional"}
          value={
            selectedPosition
              ? `${livePnl >= 0 ? "+" : ""}${fmtUsd(livePnl)}`
              : fmtUsd(notional)
          }
          color={selectedPosition ? graphColor : sideColor}
        />
      </div>

      {!selectedPosition && (
        <>
          <div className="mt-2 rounded-xl p-2" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
            <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
              Stake
            </div>
            <div className="mt-1.5 grid grid-cols-4 gap-1.5">
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
                    }}
                    className="rounded-lg px-2 py-2 text-[12px] font-black transition active:scale-[0.97]"
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
              }}
              placeholder="Custom USDC"
              className="mt-1.5 w-full rounded-lg border bg-black/20 px-3 py-2 text-[12px] font-black text-white outline-none placeholder:text-white/30"
              style={{ borderColor: FAINT }}
            />
          </div>

          <div className="mt-2 rounded-xl p-2" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
            <div className="flex items-center justify-between">
              <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                Leverage
              </div>
              <div className="text-[18px] font-black leading-none" style={{ color: sideColor }}>
                {leverage}x
              </div>
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {LEVERAGES.map((nextLeverage) => {
                const active = leverage === nextLeverage;
                return (
                  <button
                    key={nextLeverage}
                    type="button"
                    onClick={() => {
                      setLeverage(nextLeverage);
                      setError(null);
                    }}
                    className="rounded-lg px-2 py-2 text-[12px] font-black transition active:scale-[0.97]"
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
        </>
      )}

      {selectedPosition?.liquidationPriceUsd != null && (
        <div className="mt-2 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest" style={{ background: PANEL, color: DIM, border: `1px solid ${FAINT}` }}>
          Mark {fmtPrice(selectedPosition.markPriceUsd ?? selectedPosition.entryPriceUsd)} · Liq{" "}
          {fmtPrice(selectedPosition.liquidationPriceUsd)}
          {liquidationMove == null ? "" : ` · ${liquidationMove.toFixed(1)}%`}
          {" · "}
          {liveRoi >= 0 ? "+" : ""}
          {liveRoi.toFixed(1)}%
        </div>
      )}

      {(status || error || (!tradeAllowed && !selectedPosition)) && (
        <div
          className="mt-2 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest"
          style={{
            background: error ? `${RED}18` : PANEL,
            color: error ? RED : DIM,
            border: `1px solid ${error ? `${RED}45` : FAINT}`,
          }}
        >
          {error ??
            status ??
            FLASH_MIN_NOTIONAL_TEXT}
        </div>
      )}

      <div className="mt-auto pt-3 lg:pb-0">
        {!ready ? (
          <button
            type="button"
            disabled
            className="flex w-full items-center justify-center rounded-xl py-3 text-[13px] font-black uppercase tracking-widest"
            style={{ background: PANEL, color: DIM }}
          >
            Loading
          </button>
        ) : !authenticated ? (
          <button
            type="button"
            onClick={login}
            className="flex w-full items-center justify-center rounded-xl py-3 text-[13px] font-black uppercase tracking-widest transition active:scale-[0.97]"
            style={{ background: ACCENT, color: BG }}
          >
            Log in to trade
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void (selectedPosition ? closeLive() : openLive())}
            disabled={!readyToTrade || (!selectedPosition && !tradeAllowed)}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[13px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:cursor-not-allowed"
            style={{
              background: !readyToTrade
                ? PANEL
                : selectedPosition
                  ? RED
                  : sideColor,
              color: readyToTrade ? BG : DIM,
              boxShadow: readyToTrade
                ? `0 4px 0 rgba(0,0,0,0.35), inset 0 -2px 0 rgba(0,0,0,0.15)`
                : "none",
            }}
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {busy
              ? "Working"
              : selectedPosition
                ? `CLOSE ${market}`
                : `${side.toUpperCase()} ${market}`}
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
    <div className="rounded-xl p-2" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
      <div className="text-[9px] font-black uppercase tracking-widest" style={{ color: DIM }}>
        {label}
      </div>
      <div className="mt-0.5 text-[20px] font-black leading-none tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function LivePerpGraph({
  value,
  entryValue,
  color,
  activeKey,
}: {
  value: number;
  entryValue: number;
  color: string;
  activeKey: string;
}) {
  const gradientId = useId().replace(/:/g, "");
  const [points, setPoints] = useState<number[]>([]);
  const targetRef = useRef(value);
  const displayRef = useRef(value);
  targetRef.current = value;

  useEffect(() => {
    const initial = targetRef.current;
    displayRef.current = initial;
    setPoints(initial > 0 ? [initial] : []);
  }, [activeKey]);

  useEffect(() => {
    const id = setInterval(() => {
      const target = targetRef.current;
      if (target <= 0) return;
      if (displayRef.current <= 0) displayRef.current = target;
      displayRef.current += (target - displayRef.current) * 0.18;
      const next = displayRef.current;
      setPoints((current) => [...current, next].slice(-MAX_GRAPH_POINTS));
    }, GRAPH_SAMPLE_MS);
    return () => clearInterval(id);
  }, []);

  if (points.length < 2) {
    return <div className="h-full w-full" />;
  }

  const width = 320;
  const height = 170;
  const pad = 18;
  let lo = Math.min(...points, entryValue);
  let hi = Math.max(...points, entryValue);
  const span = hi - lo || hi || 1;
  lo -= span * 0.12;
  hi += span * 0.12;
  const range = hi - lo || 1;
  const xAt = (i: number) => (i / (points.length - 1)) * width;
  const yAt = (v: number) =>
    pad + (1 - (v - lo) / range) * (height - pad * 2);
  let line = `M ${xAt(0)} ${yAt(points[0])}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const mx = (xAt(i) + xAt(i + 1)) / 2;
    const my = (yAt(points[i]) + yAt(points[i + 1])) / 2;
    line += ` Q ${xAt(i)} ${yAt(points[i])} ${mx} ${my}`;
  }
  line += ` L ${xAt(points.length - 1)} ${yAt(points[points.length - 1])}`;
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  const lastX = xAt(points.length - 1);
  const lastY = yAt(points[points.length - 1]);
  const entryY = yAt(entryValue);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((tick) => {
        const y = pad + (tick * (height - pad * 2)) / 4;
        return (
          <line
            key={tick}
            x1="0"
            x2={width}
            y1={y}
            y2={y}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
          />
        );
      })}
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        stroke={color}
        strokeWidth="7"
        fill="none"
        opacity="0.22"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d={line}
        stroke={color}
        strokeWidth="2.6"
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <line
        x1="0"
        x2={width}
        y1={entryY}
        y2={entryY}
        stroke="rgba(255,255,255,0.38)"
        strokeWidth="1.2"
        strokeDasharray="5 5"
      />
      <circle cx={lastX} cy={lastY} r="11" fill={color} opacity="0.22" />
      <circle cx={lastX} cy={lastY} r="4.5" fill={color} />
    </svg>
  );
}
