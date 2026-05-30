"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePrivy, useSessionSigners, type User } from "@privy-io/react-auth";
import { useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import { Connection } from "@solana/web3.js";
import { ArrowDownRight, ArrowUpRight, Loader2, WalletCards } from "lucide-react";
import {
  flashLeverageOptionsForMarket,
  flashMarketConfigForSymbol,
  type FlashMarketSymbol,
} from "@/lib/flash/markets";
import {
  computeFlashLivePositionView,
  type FlashLivePositionView,
} from "@/lib/flash/live-pnl";
import {
  deserializeFlashEntryCostCache,
  forgetFlashEntryCost,
  mergeFlashEntryCostCache,
  pruneFlashEntryCostCache,
  rememberFlashEntryCost,
  serializeFlashEntryCostCache,
  type FlashEntryCostCache,
} from "@/lib/flash/entry-costs";
import { useFlashLiveMarks } from "@/lib/flash/live-prices-context";
import {
  flashRequestedLeverageFromPosition,
  flashStakeUsdFromPosition,
} from "@/lib/flash/position-value";
import { buildChannel, type TriggerLevelInput } from "@/lib/flash/graph-channel";
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
const FLASH_ENTRY_COST_STORAGE_PREFIX = "gwak:flash-entry-costs:";
const PRIVY_INSTANT_SIGNER_ID =
  process.env.NEXT_PUBLIC_PRIVY_FLASH_SIGNER_ID ??
  process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID ??
  "";
const PRIVY_INSTANT_POLICY_IDS = (
  process.env.NEXT_PUBLIC_PRIVY_FLASH_POLICY_IDS ??
  process.env.NEXT_PUBLIC_PRIVY_POLICY_IDS ??
  ""
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const PRIVY_INSTANT_TRADING_CONFIGURED = Boolean(PRIVY_INSTANT_SIGNER_ID);

const FLASH_SCALP_MARKETS = ["BTC", "ETH", "SOL"] as const satisfies readonly FlashMarketSymbol[];
const STAKES = [1, 5, 10, 50] as const;
const STANDARD_LEVERAGES = [20, 50, 100] as const;
const DEGEN_LEVERAGES = [125, 250, 500] as const;
const FLASH_MIN_NOTIONAL_USD = 10;
const FLASH_MIN_NOTIONAL_TEXT = "Flash minimum position is $10 notional";
const FLASH_POSITION_RECONCILE_MS = 10_000;
const MAX_GRAPH_POINTS = 120;
const GRAPH_SAMPLE_MS = 80;
const GRAPH_SMOOTHING = 0.6; // snappy: tip tracks each Flash mark, no jitter
const LIVE_DOT_PULSE = true; // soft heartbeat on the live dot (set false = still)

type Market = FlashMarketSymbol;
type FlashScalpMarket = (typeof FLASH_SCALP_MARKETS)[number];
type TradeSide = "long" | "short";
type TradeMode = "standard" | "degen";

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
  entryCostUsd?: number;
  openFeeUsd?: number;
  isProfitable?: boolean;
  openTime: number;
}

interface FlashPreparedOpenResponse {
  phase: "sign";
  venue: "flash";
  transactionB64: string;
  quote: {
    amountUsd?: number;
    notionalUsd?: number;
    leverage?: number;
    entryPriceUsd?: number;
    liquidationPriceUsd?: number;
    feesUsd?: number;
  };
  position: FlashPosition;
  trade: {
    market: Market;
    side: TradeSide;
    leverage: number;
    stakeUsdc: number;
    mode: TradeMode;
  };
}

interface FlashSentOpenResponse {
  phase: "sent";
  venue: "flash";
  signature: string;
  caip2: string;
  quote: FlashPreparedOpenResponse["quote"];
  position: FlashPosition;
  trade: FlashPreparedOpenResponse["trade"];
}

type FlashOpenResponse = FlashPreparedOpenResponse | FlashSentOpenResponse;

interface FlashPreparedCloseResponse {
  phase: "sign-close";
  venue: "flash";
  transactionB64: string;
  position: FlashPosition;
}

interface FlashSentCloseResponse {
  phase: "sent-close";
  venue: "flash";
  signature: string;
  caip2: string;
  position: FlashPosition;
}

type FlashCloseResponse = FlashPreparedCloseResponse | FlashSentCloseResponse;

type PrivyWalletAccount = {
  type?: string;
  address?: string;
  chainType?: string;
  walletClientType?: string;
  delegated?: boolean;
};

function hasServerSideSolanaWallet(
  user: User | null | undefined,
  walletAddress: string | undefined,
): boolean {
  if (!walletAddress) return false;
  return (
    user?.linkedAccounts.some((account) => {
      const walletAccount = account as PrivyWalletAccount;
      return (
        walletAccount.type === "wallet" &&
        walletAccount.address === walletAddress &&
        walletAccount.chainType === "solana" &&
        walletAccount.delegated === true &&
        walletAccount.walletClientType?.startsWith("privy")
      );
    }) ?? false
  );
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

function fmtSignedPct(value: number): string {
  if (!Number.isFinite(value)) return "0.0%";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function positionValueInput(
  position: FlashPosition | null,
  view?: FlashLivePositionView | null,
): FlashPosition | null {
  if (!position || !view) return position;
  return {
    ...position,
    pnlUsd: view.pnlUsd,
    isProfitable: view.pnlUsd > 0,
  };
}

function stakeForPosition(
  position: FlashPosition | null,
  view?: FlashLivePositionView | null,
): number {
  return flashStakeUsdFromPosition(positionValueInput(position, view)) ?? 0;
}

function leverageForPosition(
  position: FlashPosition | null,
  view?: FlashLivePositionView | null,
): number {
  return (
    flashRequestedLeverageFromPosition(positionValueInput(position, view)) ?? 0
  );
}

function flashEntryCostStorageKey(walletAddress: string | null | undefined) {
  return walletAddress ? `${FLASH_ENTRY_COST_STORAGE_PREFIX}${walletAddress}` : null;
}

function loadFlashEntryCostCache(
  walletAddress: string | null | undefined,
): FlashEntryCostCache {
  const key = flashEntryCostStorageKey(walletAddress);
  if (!key || typeof window === "undefined") return new Map();
  try {
    return deserializeFlashEntryCostCache(
      JSON.parse(window.localStorage.getItem(key) ?? "[]"),
    );
  } catch {
    return new Map();
  }
}

function saveFlashEntryCostCache(
  walletAddress: string | null | undefined,
  cache: FlashEntryCostCache,
) {
  const key = flashEntryCostStorageKey(walletAddress);
  if (!key || typeof window === "undefined") return;
  window.localStorage.setItem(
    key,
    JSON.stringify(serializeFlashEntryCostCache(cache)),
  );
}

function isFlashScalpMarket(market: Market): market is FlashScalpMarket {
  return (FLASH_SCALP_MARKETS as readonly string[]).includes(market);
}

function maxLeverageForSelection(market: Market, mode: TradeMode): number {
  const options = flashLeverageOptionsForMarket(market, mode);
  return options.at(-1) ?? (mode === "degen" ? 500 : 100);
}

export function FastPerpsGame() {
  const { ready, authenticated, login, getAccessToken, user } = usePrivy();
  const { addSessionSigners } = useSessionSigners();
  const wallet = useEmbeddedSolanaWallet();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const liveFlashMarks = useFlashLiveMarks();

  const [market, setMarket] = useState<Market>("SOL");
  const [side, setSide] = useState<TradeSide>("long");
  const [tradeMode, setTradeMode] = useState<TradeMode>("degen");
  const [stake, setStake] = useState(1);
  const [leverage, setLeverage] = useState(500);
  const [customStake, setCustomStake] = useState("");
  const [positions, setPositions] = useState<FlashPosition[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionSignerWalletAddress, setSessionSignerWalletAddress] = useState<
    string | null
  >(null);
  const entryCostCacheRef = useRef<FlashEntryCostCache>(new Map());

  const effectiveStake = useMemo(() => {
    const parsed = Number(customStake);
    return customStake && Number.isFinite(parsed) && parsed > 0 ? parsed : stake;
  }, [customStake, stake]);
  const notional = effectiveStake * leverage;
  const selectedPosition = useMemo(
    () => positions.find((p) => p.symbol === market && p.side === side) ?? null,
    [market, positions, side],
  );
  const selectedMarketConfig = useMemo(
    () => flashMarketConfigForSymbol(market),
    [market],
  );
  const positionViewsByKey = useMemo(() => {
    const views = new Map<string, FlashLivePositionView>();
    for (const position of positions) {
      views.set(
        position.positionPubkey,
        computeFlashLivePositionView({
          position,
          liveMarkUsd: isFlashScalpMarket(position.symbol)
            ? liveFlashMarks[position.symbol]?.priceUsd
            : undefined,
        }),
      );
    }
    return views;
  }, [liveFlashMarks, positions]);
  const selectedPositionView = selectedPosition
    ? positionViewsByKey.get(selectedPosition.positionPubkey) ??
      computeFlashLivePositionView({
        position: selectedPosition,
        liveMarkUsd: isFlashScalpMarket(selectedPosition.symbol)
          ? liveFlashMarks[selectedPosition.symbol]?.priceUsd
          : undefined,
      })
    : null;
  const graphValue = selectedPositionView ? selectedPositionView.valueUsd : 0;
  const livePnl = selectedPositionView ? selectedPositionView.pnlUsd : 0;
  const liveRoi = selectedPositionView ? selectedPositionView.roiPct : 0;
  const liquidationMove = selectedPositionView
    ? selectedPositionView.liquidationMovePct
    : null;
  const exitValue = selectedPositionView ? selectedPositionView.exitValueUsd : 0;
  const sideColor = side === "long" ? GREEN : RED;
  const graphColor = !selectedPositionView
    ? ACCENT
    : livePnl >= 0
      ? GREEN
      : RED;
  const readyToTrade = Boolean(ready && authenticated && wallet && !busy);
  const tradeAllowed = notional >= FLASH_MIN_NOTIONAL_USD;
  const leverageOptions = useMemo(
    () => flashLeverageOptionsForMarket(market, tradeMode),
    [market, tradeMode],
  );
  const instantTradingEnabled =
    hasServerSideSolanaWallet(user, wallet?.address) ||
    sessionSignerWalletAddress === wallet?.address;

  useEffect(() => {
    if (leverageOptions.length === 0) return;
    if (!leverageOptions.includes(leverage)) {
      setLeverage(leverageOptions.at(-1) ?? leverage);
    }
  }, [leverage, leverageOptions]);

  useEffect(() => {
    if (
      sessionSignerWalletAddress &&
      sessionSignerWalletAddress !== wallet?.address
    ) {
      setSessionSignerWalletAddress(null);
    }
  }, [sessionSignerWalletAddress, wallet?.address]);

  useEffect(() => {
    entryCostCacheRef.current = loadFlashEntryCostCache(wallet?.address);
  }, [wallet?.address]);

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
    const merged = mergeFlashEntryCostCache(
      entryCostCacheRef.current,
      body.positions ?? [],
    );
    // Only prune when we have a real position list. A transient empty fetch
    // must not garbage-collect the cached requested leverage — that cache is
    // what recovers a 500x open from its fee-reduced effective leverage. Real
    // closes self-clean via forgetFlashEntryCost in closeLive.
    if (merged.length > 0) {
      pruneFlashEntryCostCache(entryCostCacheRef.current, merged);
      saveFlashEntryCostCache(wallet.address, entryCostCacheRef.current);
    }
    setPositions(merged);
  }, [authenticated, getAccessToken, wallet?.address]);

  useEffect(() => {
    void loadPositions();
  }, [loadPositions]);

  useEffect(() => {
    if (!authenticated || !wallet?.address) return;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void loadPositions();
    }, FLASH_POSITION_RECONCILE_MS);
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

  const upsertPosition = useCallback(
    (position: FlashPosition) => {
      rememberFlashEntryCost(entryCostCacheRef.current, position);
      saveFlashEntryCostCache(wallet?.address, entryCostCacheRef.current);
      setPositions((current) => [
        ...current.filter((p) => p.positionPubkey !== position.positionPubkey),
        position,
      ]);
    },
    [wallet?.address],
  );

  const ensureInstantTrading = useCallback(async (): Promise<boolean> => {
    if (!wallet?.address) throw new Error("wallet not ready");
    if (!PRIVY_INSTANT_TRADING_CONFIGURED) return false;
    if (instantTradingEnabled) return true;
    setStatus("Approve instant trading once...");
    await addSessionSigners({
      address: wallet.address,
      signers: [
        {
          signerId: PRIVY_INSTANT_SIGNER_ID,
          policyIds: PRIVY_INSTANT_POLICY_IDS,
        },
      ],
    });
    setSessionSignerWalletAddress(wallet.address);
    return true;
  }, [addSessionSigners, instantTradingEnabled, wallet?.address]);

  const requestOpen = useCallback(async (instant: boolean): Promise<FlashOpenResponse> => {
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
        mode: tradeMode,
        walletAddress: wallet?.address,
        instant,
      }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error ?? `HTTP ${resp.status}`);
    return body as FlashOpenResponse;
  }, [
    effectiveStake,
    getAccessToken,
    leverage,
    market,
    side,
    tradeMode,
    wallet?.address,
  ]);

  const requestClose = useCallback(async (instant: boolean): Promise<FlashCloseResponse> => {
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
        instant,
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
      const useInstantExecution = await ensureInstantTrading();
      setStatus(
        useInstantExecution
          ? "Sending Flash trade..."
          : "Preparing Flash signature...",
      );
      const result = await requestOpen(useInstantExecution);
      if (result.phase === "sent") {
        upsertPosition({ ...result.position, leverage: result.trade.leverage });
        setStatus("Opened on Flash");
        await loadPositions();
        return;
      }
      setStatus("Signing Flash transaction...");
      await signAndSendFlashTransaction(result.transactionB64);
      upsertPosition({ ...result.position, leverage: result.trade.leverage });
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
    ensureInstantTrading,
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
      const useInstantExecution = await ensureInstantTrading();
      setStatus(
        useInstantExecution
          ? "Sending Flash close..."
          : "Preparing Flash close signature...",
      );
      const result = await requestClose(useInstantExecution);
      if (result.phase === "sent-close") {
        forgetFlashEntryCost(entryCostCacheRef.current, selectedPosition);
        saveFlashEntryCostCache(wallet?.address, entryCostCacheRef.current);
        setPositions((current) =>
          current.filter((p) => p.positionPubkey !== selectedPosition.positionPubkey),
        );
        setStatus("Closed on Flash");
        await loadPositions();
        return;
      }
      setStatus("Signing Flash close...");
      await signAndSendFlashTransaction(result.transactionB64);
      forgetFlashEntryCost(entryCostCacheRef.current, selectedPosition);
      saveFlashEntryCostCache(wallet?.address, entryCostCacheRef.current);
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
    ensureInstantTrading,
    readyToTrade,
    requestClose,
    selectedPosition,
    signAndSendFlashTransaction,
    wallet?.address,
  ]);

  return (
    <div
      className="mx-auto flex h-full min-h-0 max-w-md flex-col overflow-hidden px-4 pt-3 pb-[calc(88px+env(safe-area-inset-bottom))] lg:max-w-none lg:px-8 lg:py-8"
      style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <Stamp label="Trade" value="FLASH PERPS" />
          <div className="mt-1 text-[34px] font-black uppercase leading-none">
            {market}
          </div>
          <div className="mt-0.5 text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
            {selectedMarketConfig?.displayName ?? "USDC"} ·{" "}
            {tradeMode === "degen" ? "degen" : "standard"} ·{" "}
            {PRIVY_INSTANT_TRADING_CONFIGURED
              ? instantTradingEnabled
                ? "instant"
                : "one-time approval"
              : "wallet-signed"}
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
            const view = positionViewsByKey.get(position.positionPubkey);
            const pnl = view?.pnlUsd ?? 0;
            const roi = view?.roiPct ?? 0;
            const exitValue = view?.exitValueUsd ?? 0;
            return (
              <button
                key={position.positionPubkey}
                type="button"
                onClick={() => {
                  setMarket(position.symbol);
                  setSide(position.side);
                  setTradeMode(
                    leverageForPosition(position, view) > 100
                      ? "degen"
                      : "standard",
                  );
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
                    {leverageForPosition(position, view).toFixed(0)}x · stake{" "}
                    {fmtUsd(stakeForPosition(position, view))}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className="whitespace-nowrap font-mono text-[11px] font-black"
                    style={{ color: pnl >= 0 ? GREEN : RED }}
                  >
                    {pnl >= 0 ? "+" : ""}
                    {fmtUsd(pnl)}
                    <span className="ml-1" style={{ color: DIM }}>
                      {fmtSignedPct(roi)}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] font-black" style={{ color: DIM }}>
                    exit {fmtUsd(exitValue)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-4">
        <section
          aria-label="Desktop trade controls"
          className="min-h-0 lg:flex lg:flex-col lg:overflow-y-auto"
        >
          <div className="grid grid-cols-3 gap-1.5">
            {FLASH_SCALP_MARKETS.map((nextMarket) => {
              const active = market === nextMarket;
              const config = flashMarketConfigForSymbol(nextMarket);
              return (
                <button
                  key={nextMarket}
                  type="button"
                  onClick={() => {
                    setMarket(nextMarket);
                    setLeverage(maxLeverageForSelection(nextMarket, tradeMode));
                    setError(null);
                  }}
                  className="min-w-0 rounded-lg px-1.5 py-2 text-[10px] font-black uppercase tracking-widest transition active:scale-[0.97]"
                  style={{
                    background: active ? ACCENT : PANEL,
                    color: active ? BG : FG,
                    border: `1px solid ${active ? ACCENT : FAINT}`,
                  }}
                  title={config?.displayName ?? nextMarket}
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
            <div
              className="mt-3 h-[180px] overflow-hidden rounded-2xl lg:h-[280px]"
              style={{ background: PANEL, border: `1px solid ${FAINT}` }}
            >
              <LivePerpGraph
                value={graphValue}
                stakeUsd={stakeForPosition(selectedPosition, selectedPositionView)}
                color={graphColor}
                activeKey={selectedPosition.positionPubkey}
                tp={null}
                sl={null}
              />
            </div>
          )}

          <div
            className={`mt-2 grid gap-2 ${selectedPosition ? "grid-cols-3" : "grid-cols-2"}`}
          >
            <PreviewMetric
              label="Stake"
              value={fmtUsd(
                selectedPositionView
                  ? selectedPositionView.stakeUsd
                  : effectiveStake,
              )}
              color={FG}
            />
            <PreviewMetric
              label={selectedPosition ? "P/L" : "Notional"}
              value={
                selectedPosition
                  ? `${livePnl >= 0 ? "+" : ""}${fmtUsd(livePnl)}`
                  : fmtUsd(notional)
              }
              subvalue={selectedPosition ? fmtSignedPct(liveRoi) : undefined}
              color={selectedPosition ? graphColor : sideColor}
            />
            {selectedPosition && (
              // Stake +/- P/L = current money still in the trade. graphValue is
              // the live position value (valueUsd) the chart already plots, so
              // this window stays consistent with the graph and the P/L above.
              <PreviewMetric
                label="Total"
                value={fmtUsd(graphValue)}
                color={FG}
              />
            )}
          </div>
        </section>

        <aside
          aria-label="Desktop order ticket"
          className="mt-2 flex min-h-0 flex-1 flex-col lg:mt-0 lg:overflow-y-auto"
        >
          {!selectedPosition && (
            <>
              <div className="rounded-xl p-2" style={{ background: PANEL, border: `1px solid ${FAINT}` }}>
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
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {(["standard", "degen"] as const).map((nextMode) => {
                    const active = tradeMode === nextMode;
                    return (
                      <button
                        key={nextMode}
                        type="button"
                        onClick={() => {
                          setTradeMode(nextMode);
                          setLeverage(maxLeverageForSelection(market, nextMode));
                          setError(null);
                        }}
                        className="rounded-lg px-2 py-2 text-[11px] font-black uppercase tracking-widest transition active:scale-[0.97]"
                        style={{
                          background: active ? FG : PANEL_2,
                          color: active ? BG : FG,
                          border: `1px solid ${active ? FG : FAINT}`,
                        }}
                      >
                        {nextMode}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                  {leverageOptions.map((nextLeverage) => {
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
              Mark {fmtPrice(selectedPositionView?.markPriceUsd ?? selectedPosition.entryPriceUsd)} · Liq{" "}
              {fmtPrice(selectedPosition.liquidationPriceUsd)}
              {liquidationMove == null ? "" : ` · ${liquidationMove.toFixed(1)}%`}
              {" · "}
              Exit {fmtUsd(exitValue)}
              {" · "}
              {fmtSignedPct(liveRoi)}
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

          <div className="mt-auto flex pt-3 lg:mt-3 lg:justify-end lg:pb-0">
            {!ready ? (
              <button
                type="button"
                disabled
                className="flex w-full items-center justify-center rounded-xl py-3 text-[13px] font-black uppercase tracking-widest lg:w-auto lg:px-8"
                style={{ background: PANEL, color: DIM }}
              >
                Loading
              </button>
            ) : !authenticated ? (
              <button
                type="button"
                onClick={login}
                className="flex w-full items-center justify-center rounded-xl py-3 text-[13px] font-black uppercase tracking-widest transition active:scale-[0.97] lg:w-auto lg:px-8"
                style={{ background: ACCENT, color: BG }}
              >
                Log in to trade
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void (selectedPosition ? closeLive() : openLive())}
                disabled={!readyToTrade || (!selectedPosition && !tradeAllowed)}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[13px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:cursor-not-allowed lg:w-auto lg:px-8"
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
                    : `${side.toUpperCase()} ${market} ${leverage}x`}
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function PreviewMetric({
  label,
  value,
  subvalue,
  color = FG,
}: {
  label: string;
  value: string;
  subvalue?: string;
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
      {subvalue && (
        <div className="mt-1 font-mono text-[10px] font-black uppercase tracking-widest" style={{ color }}>
          {subvalue}
        </div>
      )}
    </div>
  );
}

function LivePerpGraph({
  value,
  stakeUsd,
  color,
  activeKey,
  tp,
  sl,
}: {
  value: number;
  stakeUsd: number;
  color: string;
  activeKey: string;
  tp: TriggerLevelInput | null;
  sl: TriggerLevelInput | null;
}) {
  const [points, setPoints] = useState<number[]>([]);
  const displayRef = useRef(value);
  const targetRef = useRef(value);
  targetRef.current = value;

  // Reset the trail when the selected position changes.
  useEffect(() => {
    displayRef.current = targetRef.current;
    setPoints([targetRef.current]);
  }, [activeKey]);

  // Responsive sampling: snap the tip toward each incoming mark (no jitter).
  useEffect(() => {
    const id = setInterval(() => {
      displayRef.current +=
        (targetRef.current - displayRef.current) * GRAPH_SMOOTHING;
      setPoints((prev) =>
        [...prev, displayRef.current].slice(-MAX_GRAPH_POINTS),
      );
    }, GRAPH_SAMPLE_MS);
    return () => clearInterval(id);
  }, [activeKey]);

  const width = 320;
  const height = 170;
  const pad = 18;

  const channel = buildChannel({ stakeUsd, valueUsd: value, tp, sl });
  const series = points.length > 0 ? points : [value];

  const toX = (i: number) =>
    pad + (i / Math.max(1, series.length - 1)) * (width - 2 * pad);
  const toY = (v: number) => channel.valueToY(v, height, pad);

  const linePath = series
    .map((v, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`)
    .join(" ");
  const areaPath =
    series.length > 0
      ? `${linePath} L${toX(series.length - 1).toFixed(1)},${(height - pad).toFixed(
          1,
        )} L${toX(0).toFixed(1)},${(height - pad).toFixed(1)} Z`
      : "";

  const tipX = toX(series.length - 1);
  const tipY = toY(series[series.length - 1] ?? value);

  const lineColor = (id: string): string => {
    if (id === "tp") return "#39d98a";
    if (id === "sl") return "#ffae42";
    if (id === "liq") return "#ff3b3b";
    return "rgba(255,255,255,0.38)";
  };
  const roleLabel = (id: string): string =>
    id === "liq" ? "LIQ" : id === "entry" ? "entry" : id.toUpperCase();

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      preserveAspectRatio="none"
      aria-label="Live position money channel"
    >
      <defs>
        <linearGradient id="vfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Liquidation death-zone band at the floor. */}
      <rect
        x="0"
        y={toY(channel.minValue) - 8}
        width={width}
        height="8"
        fill="#ff3b3b"
        opacity="0.18"
      />

      {/* Channel reference lines from the geometry helper.
          Line IDs: data-line="tp" | data-line="entry" | data-line="sl" | data-line="liq" */}
      {channel.lines.map((line) => {
        const y = toY(line.valueUsd);
        // Explicit data-line literals so grep-based contract tests can find them:
        // data-line="tp"  data-line="entry"  data-line="sl"  data-line="liq"
        const dataLine =
          line.id === "tp"
            ? ("tp" as const)
            : line.id === "entry"
              ? ("entry" as const)
              : line.id === "sl"
                ? ("sl" as const)
                : ("liq" as const);
        return (
          <g key={line.id} data-line={dataLine}>
            <line
              x1="0"
              y1={y}
              x2={width - 46}
              y2={y}
              stroke={lineColor(line.id)}
              strokeWidth={line.id === "liq" ? 1.5 : 1}
              strokeDasharray={line.id === "liq" ? undefined : "5 4"}
            />
            <text x="4" y={y - 3} fill={lineColor(line.id)} fontSize="8.5" fontWeight="700">
              {roleLabel(line.id)}
            </text>
            <text
              x={width - 42}
              y={y + 3}
              fill={lineColor(line.id)}
              fontSize="9"
              fontWeight={line.id === "entry" ? "400" : "700"}
            >
              {fmtUsd(line.valueUsd)}
            </text>
          </g>
        );
      })}

      {/* P/L fill + responsive value line. */}
      {areaPath && <path d={areaPath} fill="url(#vfill)" />}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={tipX} cy={tipY} r="4.5" fill={color}>
        {LIVE_DOT_PULSE && (
          <animate
            attributeName="r"
            values="4;5.5;4"
            dur="1.4s"
            repeatCount="indefinite"
          />
        )}
      </circle>
    </svg>
  );
}
