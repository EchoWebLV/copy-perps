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
import {
  buildChannel,
  type ChannelLine,
  type TriggerKind,
  type TriggerLevelInput,
} from "@/lib/flash/graph-channel";
import { useEmbeddedSolanaWallet } from "@/lib/privy/use-solana-wallet";
import { AutopilotPanel } from "@/components/trade/AutopilotPanel";
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
const TP_PRESETS = [50, 100, 200] as const; // % ROI on collateral
const SL_PRESETS = [-25, -50, -75] as const;
const STANDARD_LEVERAGES = [20, 50, 100] as const;
const DEGEN_LEVERAGES = [125, 250, 500] as const;
const FLASH_MIN_NOTIONAL_USD = 10;
const FLASH_MIN_NOTIONAL_TEXT = "Flash minimum position is $10 notional";
const FLASH_POSITION_RECONCILE_MS = 10_000;
const MAX_GRAPH_POINTS = 120;
const GRAPH_SAMPLE_MS = 80;
const GRAPH_SMOOTHING = 0.6; // snappy: tip tracks each Flash mark, no jitter
const LIVE_DOT_PULSE = true; // soft heartbeat on the live dot (set false = still)
const CURVE_TENSION = 0.16; // Catmull-Rom→bezier smoothing for the live value curve
const WINDOW_K = 0.7; // auto-range padding: live series fills ~1/(2·K) ≈ 71% of graph height

type Market = FlashMarketSymbol;
type FlashScalpMarket = (typeof FLASH_SCALP_MARKETS)[number];
type TradeSide = "long" | "short";
type TradeMode = "standard" | "degen";

// On-chain trigger order attached to a position (from the positions poll).
interface PositionTrigger {
  kind: TriggerKind;
  orderId: number;
  triggerPriceUsd: number;
  roiPct: number;
}

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
  triggers?: PositionTrigger[];
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
  const [autopilotMode, setAutopilotMode] = useState(false);
  // True while the server says an autopilot session is running — drives the
  // "manual trades can merge with autopilot positions" warning on the
  // Manual view. Set by the mount probe below.
  const [autopilotSessionActive, setAutopilotSessionActive] = useState(false);
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
  // Idle hero chart: before a position is open the big left graph plots the
  // selected market's live mark in gray, so the panel is alive and flips to the
  // colored money line the moment the user opens.
  const idleMarkUsd = isFlashScalpMarket(market)
    ? liveFlashMarks[market]?.priceUsd ?? 0
    : 0;
  const selectedTriggers = useMemo(() => {
    const list = selectedPosition?.triggers ?? [];
    const pick = (kind: TriggerKind): TriggerLevelInput | null => {
      const found = list.find((t) => t.kind === kind);
      return found ? { kind, roiPct: found.roiPct } : null;
    };
    const orderId = (kind: TriggerKind): number | null =>
      list.find((t) => t.kind === kind)?.orderId ?? null;
    return {
      tp: pick("tp"),
      sl: pick("sl"),
      tpOrderId: orderId("tp"),
      slOrderId: orderId("sl"),
    };
  }, [selectedPosition]);
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

  // One-shot probe: if an autopilot session is already running, land the
  // user on the Autopilot view instead of the manual ticket.
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const resp = await fetch("/api/autopilot/session", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) return;
        const body = (await resp.json()) as {
          session?: { status?: string } | null;
        };
        if (!cancelled && body.session?.status === "active") {
          setAutopilotSessionActive(true);
          setAutopilotMode(true);
        }
      } catch {
        // non-fatal — the toggle still works manually
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated, getAccessToken]);

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

  const requestTrigger = useCallback(
    async (kind: TriggerKind, roiPct: number) => {
      if (!selectedPosition) return;
      const walletAddress = wallet?.address;
      if (!walletAddress) {
        setError("Connect a wallet first.");
        return;
      }
      setError(null);
      setBusy(true);
      setStatus(kind === "tp" ? "Setting take-profit..." : "Setting stop-loss...");
      try {
        const useInstant = await ensureInstantTrading();
        const orderId =
          kind === "tp" ? selectedTriggers.tpOrderId : selectedTriggers.slOrderId;
        const token = await getAccessToken();
        const res = await fetch("/api/flash/perp/trigger", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            market: selectedPosition.symbol,
            side: selectedPosition.side,
            kind,
            roiPct,
            orderId: orderId ?? undefined,
            walletAddress,
            instant: useInstant,
          }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result?.error ?? "Trigger failed");
        if (result.phase === "sent-trigger") {
          setStatus(kind === "tp" ? "Take-profit set" : "Stop-loss set");
        } else if (result.phase === "sign-trigger") {
          setStatus("Signing trigger...");
          await signAndSendFlashTransaction(result.transactionB64);
          setStatus(kind === "tp" ? "Take-profit set" : "Stop-loss set");
        }
        await loadPositions();
      } catch (err) {
        setError(formatTailSigningError(err).slice(0, 220));
        setStatus(null);
      } finally {
        setBusy(false);
      }
    },
    [
      selectedPosition,
      selectedTriggers,
      wallet?.address,
      ensureInstantTrading,
      getAccessToken,
      signAndSendFlashTransaction,
      loadPositions,
    ],
  );

  const cancelTrigger = useCallback(
    async (kind: TriggerKind) => {
      if (!selectedPosition) return;
      const orderId =
        kind === "tp" ? selectedTriggers.tpOrderId : selectedTriggers.slOrderId;
      const walletAddress = wallet?.address;
      if (!walletAddress || orderId === null) return;
      setError(null);
      setBusy(true);
      setStatus("Cancelling trigger...");
      try {
        const useInstant = await ensureInstantTrading();
        const token = await getAccessToken();
        const res = await fetch("/api/flash/perp/trigger", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            market: selectedPosition.symbol,
            side: selectedPosition.side,
            kind,
            orderId,
            walletAddress,
            instant: useInstant,
          }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result?.error ?? "Cancel failed");
        if (result.phase === "sent-trigger-cancel") {
          setStatus("Trigger cancelled");
        } else if (result.phase === "sign-trigger-cancel") {
          setStatus("Signing cancel...");
          await signAndSendFlashTransaction(result.transactionB64);
          setStatus("Trigger cancelled");
        }
        await loadPositions();
      } catch (err) {
        setError(formatTailSigningError(err).slice(0, 220));
        setStatus(null);
      } finally {
        setBusy(false);
      }
    },
    [
      selectedPosition,
      selectedTriggers,
      wallet?.address,
      ensureInstantTrading,
      getAccessToken,
      signAndSendFlashTransaction,
      loadPositions,
    ],
  );

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

      <div className="mt-3 flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_auto] lg:content-start lg:gap-x-4 lg:gap-y-3">
        <section
          aria-label="Desktop trade controls"
          className="min-h-0 lg:col-start-2 lg:row-start-1"
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

        </section>

        <section
          aria-label="Live chart"
          className="min-h-0 lg:col-start-1 lg:row-start-1 lg:row-span-2 lg:flex lg:flex-col"
        >
          {/* The hero graph. Idle (no position) it plots the selected market's
              live mark tinted by the chosen side; with a position open it
              flips to the colored money line. Mobile shows a compact idle
              chart too — picking a side with no price on screen was blind. */}
          <div
            className={`overflow-hidden rounded-2xl ${
              selectedPosition ? "mt-3 h-[180px]" : "mt-3 h-[140px]"
            } lg:mt-0 lg:block lg:h-auto lg:min-h-0 lg:flex-1`}
            style={{ background: PANEL, border: `1px solid ${FAINT}` }}
          >
            <LivePerpGraph
              idle={!selectedPosition}
              symbol={market}
              value={selectedPosition ? graphValue : idleMarkUsd}
              stakeUsd={
                selectedPosition
                  ? stakeForPosition(selectedPosition, selectedPositionView)
                  : effectiveStake
              }
              color={
                selectedPosition
                  ? graphColor
                  : side === "long"
                    ? `${GREEN}9e`
                    : `${RED}9e`
              }
              activeKey={
                selectedPosition
                  ? selectedPosition.positionPubkey
                  : `idle-${market}`
              }
              tp={selectedPosition ? selectedTriggers.tp : null}
              sl={selectedPosition ? selectedTriggers.sl : null}
              entryPriceUsd={
                selectedPosition ? selectedPosition.entryPriceUsd : idleMarkUsd
              }
              liqPriceUsd={
                selectedPosition
                  ? selectedPosition.liquidationPriceUsd ?? null
                  : null
              }
              leverage={
                selectedPosition
                  ? leverageForPosition(selectedPosition, selectedPositionView)
                  : leverage
              }
              side={selectedPosition ? selectedPosition.side : side}
            />
          </div>
        </section>

        <aside
          aria-label="Desktop order ticket"
          className="mt-2 flex min-h-0 flex-1 flex-col lg:col-start-2 lg:row-start-2 lg:mt-0 lg:overflow-y-auto"
        >
          <div
            className={`grid gap-2 ${selectedPosition ? "grid-cols-3" : "grid-cols-2"}`}
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

          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {([false, true] as const).map((next) => {
              const isActive = autopilotMode === next;
              return (
                <button
                  key={String(next)}
                  type="button"
                  onClick={() => setAutopilotMode(next)}
                  className="rounded-lg px-2 py-2 text-[11px] font-black uppercase tracking-widest transition active:scale-[0.97]"
                  style={{
                    background: isActive ? FG : PANEL_2,
                    color: isActive ? BG : FG,
                    border: `1px solid ${isActive ? FG : FAINT}`,
                  }}
                >
                  {next ? "Autopilot" : "Manual"}
                </button>
              );
            })}
          </div>

          {autopilotMode ? (
            <AutopilotPanel />
          ) : (
            <>
              {autopilotSessionActive && (
                <div
                  className="mt-2 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest"
                  style={{
                    background: PANEL,
                    color: DIM,
                    border: `1px solid ${FAINT}`,
                  }}
                >
                  Autopilot is running. Manual trades on BTC / ETH / SOL can
                  merge with its positions — switch to the Autopilot tab to
                  manage it.
                </div>
              )}
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

          {selectedPosition && (
            <>
              {/* Mobile keeps the compact one-line strip so the phone view
                  stays inside its no-scroll frame. */}
              <div
                className="mt-2 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest lg:hidden"
                style={{ background: PANEL, color: DIM, border: `1px solid ${FAINT}` }}
              >
                Mark {fmtPrice(selectedPositionView?.markPriceUsd ?? selectedPosition.entryPriceUsd)}
                {" · Liq "}
                {selectedPosition.liquidationPriceUsd != null
                  ? fmtPrice(selectedPosition.liquidationPriceUsd)
                  : "—"}
                {liquidationMove == null ? "" : ` · ${Math.abs(liquidationMove).toFixed(1)}% away`}
                {" · "}
                <span style={{ color: graphColor }}>{fmtSignedPct(liveRoi)}</span>
              </div>

              {/* Desktop order ticket: live price + risk stats stacked into the
                  right column so it reads like a real perp terminal instead of a
                  lone pill floating in dead space. Money (stake / P/L / total)
                  lives in the left metrics; this side is price + risk + the exit
                  preview that sits right above CLOSE. */}
              <div
                className="hidden rounded-xl p-3 lg:block"
                style={{ background: PANEL, border: `1px solid ${FAINT}` }}
              >
                <div className="flex items-baseline justify-between gap-3 py-1">
                  <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                    Mark
                  </span>
                  <span className="text-[15px] font-black tabular-nums" style={{ color: FG }}>
                    {fmtPrice(selectedPositionView?.markPriceUsd ?? selectedPosition.entryPriceUsd)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 py-1">
                  <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                    Entry
                  </span>
                  <span className="text-[15px] font-black tabular-nums" style={{ color: FG }}>
                    {fmtPrice(selectedPosition.entryPriceUsd)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 py-1">
                  <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: DIM }}>
                    Liq
                  </span>
                  <span className="flex items-baseline gap-1.5 text-[15px] font-black tabular-nums" style={{ color: RED }}>
                    {selectedPosition.liquidationPriceUsd != null
                      ? fmtPrice(selectedPosition.liquidationPriceUsd)
                      : "—"}
                    {liquidationMove != null && (
                      <span className="text-[10px] font-bold" style={{ color: DIM }}>
                        {Math.abs(liquidationMove).toFixed(1)}% away
                      </span>
                    )}
                  </span>
                </div>
                <div
                  className="mt-1 flex items-baseline justify-between gap-3 border-t pt-2"
                  style={{ borderColor: FAINT }}
                >
                  <span className="text-[15px] font-black tabular-nums" style={{ color: graphColor }}>
                    Exit {fmtUsd(exitValue)}
                  </span>
                  <span className="text-[12px] font-black" style={{ color: graphColor }}>
                    {fmtSignedPct(liveRoi)}
                  </span>
                </div>
              </div>

              <TriggerChips
                triggers={selectedTriggers}
                disabled={busy}
                onPlace={(kind, roiPct) => void requestTrigger(kind, roiPct)}
                onCancel={(kind) => void cancelTrigger(kind)}
              />
            </>
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
                className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-[13px] font-black uppercase tracking-widest transition active:scale-[0.97] disabled:cursor-not-allowed"
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
            </>
          )}
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

function TriggerChips({
  triggers,
  onPlace,
  onCancel,
  disabled,
}: {
  triggers: { tp: TriggerLevelInput | null; sl: TriggerLevelInput | null };
  onPlace: (kind: TriggerKind, roiPct: number) => void;
  onCancel: (kind: TriggerKind) => void;
  disabled: boolean;
}) {
  // Which kind is mid-pick. Tapping "+ Add" opens this inline picker; the
  // wallet is only asked to sign once the user taps an actual level — so the
  // level is always chosen *before* any signature is requested.
  const [picking, setPicking] = useState<TriggerKind | null>(null);

  const chip = (kind: TriggerKind) => {
    const level = kind === "tp" ? triggers.tp : triggers.sl;
    const accent = kind === "tp" ? "#39d98a" : "#ffae42";
    const label = kind === "tp" ? "TP" : "SL";

    // Active trigger already placed: show the level with a cancel affordance.
    if (level) {
      return (
        <div
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border px-2 py-2 text-[11px] font-bold"
          style={{ borderColor: accent, color: accent }}
        >
          <span>
            {label} {fmtSignedPct(level.roiPct)}
          </span>
          <button
            type="button"
            aria-label={`Cancel ${kind === "tp" ? "take-profit" : "stop-loss"}`}
            disabled={disabled}
            onClick={() => onCancel(kind)}
            className="-my-2 px-2 py-2 leading-none"
          >
            ✕
          </button>
        </div>
      );
    }

    // Mid-pick: choose a level first. Only the tapped preset places + signs.
    if (picking === kind) {
      const presets = kind === "tp" ? TP_PRESETS : SL_PRESETS;
      return (
        <div
          className="flex flex-1 items-center gap-1 rounded-lg border px-1 py-1"
          style={{ borderColor: accent }}
        >
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={disabled}
              onClick={() => {
                setPicking(null);
                onPlace(kind, preset);
              }}
              className="flex-1 rounded-md px-1 py-1.5 text-[11px] font-black lg:cursor-ns-resize"
              style={{ background: `${accent}22`, color: accent }}
            >
              {fmtSignedPct(preset)}
            </button>
          ))}
          <button
            type="button"
            aria-label="Dismiss level picker"
            onClick={() => setPicking(null)}
            className="px-1.5 py-1 text-[11px] leading-none"
            style={{ color: "#7a7a84" }}
          >
            ✕
          </button>
        </div>
      );
    }

    // Default ghost button: opens the picker — no signature yet.
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setPicking(kind)}
        className="flex-1 rounded-lg border border-dashed px-2 py-2 text-[11px] font-bold lg:cursor-ns-resize"
        style={{ borderColor: "#3a3a42", color: "#7a7a84" }}
      >
        {kind === "tp" ? "+ Add TP" : "+ Add SL"}
      </button>
    );
  };

  return (
    <div className="mt-2 flex gap-2">
      {chip("tp")}
      {chip("sl")}
    </div>
  );
}

// Smooth a polyline into a flowing cubic-bezier curve so the live trail reads
// like a money chart instead of a hand-drawn zig-zag.
function smoothLine(pts: Array<{ x: number; y: number }>): string {
  if (pts.length === 0) return "";
  if (pts.length < 3) {
    return pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ");
  }
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) * CURVE_TENSION;
    const c1y = p1.y + (p2.y - p0.y) * CURVE_TENSION;
    const c2x = p2.x - (p3.x - p1.x) * CURVE_TENSION;
    const c2y = p2.y - (p3.y - p1.y) * CURVE_TENSION;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function LivePerpGraph({
  value,
  stakeUsd,
  color,
  activeKey,
  tp,
  sl,
  entryPriceUsd,
  liqPriceUsd,
  leverage,
  side,
  idle = false,
  symbol,
}: {
  value: number;
  stakeUsd: number;
  color: string;
  activeKey: string;
  tp: TriggerLevelInput | null;
  sl: TriggerLevelInput | null;
  entryPriceUsd: number;
  liqPriceUsd: number | null;
  leverage: number;
  side: TradeSide;
  // Idle hero state: no open position yet. The graph plots the selected
  // market's live mark in gray with no money-channel reference lines, so the
  // panel breathes before the trade and lights up into the colored value line
  // the moment a position exists.
  idle?: boolean;
  symbol?: string;
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

  // Render at the container's real pixel size so a 320-wide viewBox isn't
  // stretched non-uniformly on desktop (that distortion is what made strokes,
  // dashes and text look smeared on wide screens).
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 360, h: 200 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const width = size.w;
  const height = size.h;
  const pad = 16;
  const floorY = height - pad;
  const plotH = height - 2 * pad;

  const channel = buildChannel({ stakeUsd, valueUsd: value, tp, sl });
  const series = points.length > 0 ? points : [value];

  // Auto-range the Y axis to the live trail rather than the full liq→TP domain.
  // The fixed domain squashed every tick into a sliver near the top (huge dead
  // space, no visible amplitude). Centering on the trail with a minimum span +
  // padding lets the line fill the height and actually move. WINDOW_K sets how
  // much of the height the data band occupies (≈ 1 / (2·K)).
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const mid = (lo + hi) / 2;
  const minSpan = Math.max(Math.abs(value) * 0.05, 0.02);
  const span = Math.max(hi - lo, minSpan);
  const winMin = mid - span * WINDOW_K;
  const winMax = mid + span * WINDOW_K;
  const winRange = winMax - winMin || 1;

  const toX = (i: number) =>
    pad + (i / Math.max(1, series.length - 1)) * (width - 2 * pad);
  const toY = (v: number) => {
    const t = Math.min(1, Math.max(0, (v - winMin) / winRange));
    return floorY - t * plotH;
  };

  const pts = series.map((v, i) => ({ x: toX(i), y: toY(v) }));
  const linePath = smoothLine(pts);

  const firstX = pts[0]?.x ?? toX(0);
  const lastX = pts[pts.length - 1]?.x ?? toX(0);
  const areaPath =
    pts.length > 0
      ? `${linePath} L${lastX.toFixed(1)},${floorY.toFixed(1)} L${firstX.toFixed(1)},${floorY.toFixed(1)} Z`
      : "";

  const tip = pts[pts.length - 1] ?? { x: toX(0), y: toY(value) };

  // Translate any channel line's ROI into the SOL price a trader actually reads:
  //   roi% = priceMove% · leverage · sideSign · 100  ⇒  price = entry·(1 + move)
  const sideSign = side === "long" ? 1 : -1;
  const priceForRoi = (roiPct: number): number => {
    if (!Number.isFinite(entryPriceUsd) || entryPriceUsd <= 0 || leverage <= 0) {
      return entryPriceUsd;
    }
    return entryPriceUsd * (1 + roiPct / (leverage * sideSign * 100));
  };
  const priceLabel = (id: string, roiPct: number): string => {
    if (id === "entry") return fmtPrice(entryPriceUsd);
    if (id === "liq") return fmtPrice(liqPriceUsd ?? priceForRoi(-100));
    return fmtPrice(priceForRoi(roiPct));
  };

  const lineColor = (id: string): string => {
    if (id === "tp") return "#39d98a";
    if (id === "sl") return "#ffae42";
    if (id === "liq") return "#ff3b3b";
    return "rgba(255,255,255,0.45)";
  };
  const roleLabel = (id: string): string =>
    id === "liq" ? "LIQ" : id === "entry" ? "entry" : id.toUpperCase();

  // In-window reference levels draw in place; the nearest level above and below
  // pin to the edges as guard rails (your nearest target + nearest threat) so
  // they stay informative without re-squashing the line or stacking labels.
  const inWindow = channel.lines.filter(
    (l) => l.valueUsd >= winMin && l.valueUsd <= winMax,
  );
  const nearestAbove = channel.lines
    .filter((l) => l.valueUsd > winMax)
    .sort((a, b) => a.valueUsd - b.valueUsd)[0];
  const nearestBelow = channel.lines
    .filter((l) => l.valueUsd < winMin)
    .sort((a, b) => b.valueUsd - a.valueUsd)[0];
  // Idle hero shows just the gray live-mark line — no money-channel guard rails
  // (there is no position to risk yet). They reappear the moment a trade opens.
  const refLines: Array<{
    line: ChannelLine;
    y: number;
    edge: "top" | "bottom" | null;
  }> = idle
    ? []
    : [
        ...inWindow.map((line) => ({ line, y: toY(line.valueUsd), edge: null })),
        ...(nearestAbove
          ? [{ line: nearestAbove, y: pad, edge: "top" as const }]
          : []),
        ...(nearestBelow
          ? [{ line: nearestBelow, y: floorY, edge: "bottom" as const }]
          : []),
      ];

  return (
    <div ref={containerRef} className="h-full w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        aria-label="Live position money channel"
      >
        <defs>
          <linearGradient id="vfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.34" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
          <filter id="tipGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Area fill under the live curve. */}
        {areaPath && <path d={areaPath} fill="url(#vfill)" />}

        {/* Reference levels — in-window lines in place, nearest above/below
            pinned to the edges as guard rails. Each keeps its role as a
            data-line marker and is labelled with its SOL price. */}
        {refLines.map(({ line, y, edge }) => {
          const stroke = lineColor(line.id);
          const labelY = edge === "top" ? y + 11 : y - 4;
          const arrow = edge === "top" ? " ↑" : edge === "bottom" ? " ↓" : "";
          return (
            <g key={line.id} data-line={line.id} opacity={edge ? 0.72 : 1}>
              <line
                x1={pad}
                y1={y}
                x2={width - pad}
                y2={y}
                stroke={stroke}
                strokeWidth={line.id === "liq" ? 1.4 : 1}
                strokeDasharray={
                  edge ? "2 4" : line.id === "liq" ? undefined : "4 5"
                }
                opacity={line.id === "entry" && !edge ? 0.55 : 0.85}
              />
              <text
                x={pad + 2}
                y={labelY}
                fill={stroke}
                fontSize="9"
                fontWeight="800"
                stroke={BG}
                strokeWidth="2.5"
                strokeLinejoin="round"
                style={{ paintOrder: "stroke" }}
              >
                {roleLabel(line.id)}
              </text>
              <text
                x={width - pad - 2}
                y={labelY}
                textAnchor="end"
                fill={stroke}
                fontSize="10"
                fontWeight="800"
                stroke={BG}
                strokeWidth="2.5"
                strokeLinejoin="round"
                style={{ paintOrder: "stroke" }}
              >
                {priceLabel(line.id, line.roiPct)}
                {arrow}
              </text>
            </g>
          );
        })}

        {/* Live value curve + glowing tip. */}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={tip.x} cy={tip.y} r="4" fill={color} filter="url(#tipGlow)">
          {LIVE_DOT_PULSE && (
            <animate
              attributeName="r"
              values="3.5;5;3.5"
              dur="1.4s"
              repeatCount="indefinite"
            />
          )}
        </circle>

        {/* Idle hero label: a LIVE badge + the current mark so the gray pre-trade
            chart reads as a live ticker, not a dead placeholder. */}
        {idle && (
          <>
            <text
              x={pad + 2}
              y={pad + 4}
              fill="rgba(250,250,242,0.55)"
              fontSize="9"
              fontWeight="800"
              stroke={BG}
              strokeWidth="2.5"
              strokeLinejoin="round"
              style={{ paintOrder: "stroke", letterSpacing: "0.14em" }}
            >
              {`LIVE${symbol ? ` ${symbol}` : ""}`}
            </text>
            <text
              x={width - pad - 2}
              y={pad + 4}
              textAnchor="end"
              fill={FG}
              fontSize="11"
              fontWeight="800"
              stroke={BG}
              strokeWidth="2.5"
              strokeLinejoin="round"
              style={{ paintOrder: "stroke" }}
            >
              {fmtPrice(value)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
