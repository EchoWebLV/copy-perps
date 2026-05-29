import { db } from "@/lib/db";
import { whalePositionAnalysis } from "@/lib/db/schema";
import { isSourceFresh } from "@/lib/whales/identity";
import { inArray } from "drizzle-orm";
import type { WhalePositionSignal, WhaleTraderSignal } from "@/lib/types";
import { getPortfolio } from "@/lib/hyperliquid/client";
import type { HLPortfolio, HLPortfolioWindow } from "@/lib/hyperliquid/client";
import { getLeaderboard, getPositionsHistory } from "@/lib/pacifica/client";
import type { PacificaLeaderboardEntry } from "@/lib/pacifica/types";
import {
  fallbackWhaleAnalysis,
  whaleEntryGapWarning,
} from "@/lib/whales/analysis";
import {
  buildWhalePnlCurve,
  type WhalePnlPoint,
} from "@/lib/whales/pnl-curve";
import {
  getWhaleLiveSnapshot,
  type WhaleLiveSnapshot,
} from "@/lib/whales/live-cache";
import { refreshWhales } from "@/lib/whales/refresh";
import { isFlashCopyableMarket } from "@/lib/flash/markets";

const PNL_HISTORY_LIMIT = 500;
const PNL_HISTORY_CACHE_MS = 5 * 60_000;
const PNL_HISTORY_CONCURRENCY = 4;
const LIVE_SNAPSHOT_COLD_START_BUDGET_MS =
  process.env.NODE_ENV === "test" ? 10 : 750;
const RECENT_POSITION_STALE_GRACE_MS = 60 * 60_000;
const TRADER_SIGNALS_CACHE_MS = 30_000;
const TRADER_SIGNALS_EMPTY_CACHE_MS = 1_000;
const TRADER_SIGNALS_STALE_MS = 5 * 60_000;
const TRADER_SIGNALS_COLD_START_BUDGET_MS =
  process.env.NODE_ENV === "test" ? 10 : 750;

type WhaleTraderStats = WhaleTraderSignal["payload"]["stats"];

const pnlHistoryCache = new Map<
  string,
  { expiresAt: number; curve: WhalePnlPoint[] }
>();
let liveRefreshInFlight: Promise<void> | null = null;
let traderSignalsCache:
  | {
      signals: WhaleTraderSignal[];
      expiresAt: number;
      staleUntil: number;
    }
  | null = null;
let traderSignalsInFlight: Promise<WhaleTraderSignal[]> | null = null;

async function refreshLiveSnapshotOnce(): Promise<void> {
  if (!liveRefreshInFlight) {
    liveRefreshInFlight = refreshWhales()
      .then(() => undefined)
      .finally(() => {
        liveRefreshInFlight = null;
      });
  }

  await liveRefreshInFlight;
}

async function refreshLiveSnapshotWithinBudget(): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      refreshLiveSnapshotOnce().then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => {
          resolve(false);
        }, LIVE_SNAPSHOT_COLD_START_BUDGET_MS);
      }),
    ]);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

async function getWhaleLiveSnapshotOrRefresh(): Promise<WhaleLiveSnapshot | null> {
  const snapshot = await getWhaleLiveSnapshot();
  if (
    snapshot !== null &&
    isSourceFresh(snapshot.observedAt.getTime()) &&
    isCompleteLiveSnapshot(snapshot)
  ) {
    return snapshot;
  }

  if (snapshot !== null && isSourceFresh(snapshot.observedAt.getTime())) {
    try {
      const refreshed = await refreshLiveSnapshotWithinBudget();
      if (!refreshed) return snapshot;
    } catch (err) {
      console.warn("[whales] source-completion refresh failed:", err);
      return snapshot;
    }

    return (await getWhaleLiveSnapshot()) ?? snapshot;
  }

  if (snapshot !== null) {
    void refreshLiveSnapshotOnce().catch((err) => {
      console.warn("[whales] background refresh failed:", err);
    });
    return snapshot;
  }

  try {
    const refreshed = await refreshLiveSnapshotWithinBudget();
    if (!refreshed) return snapshot;
  } catch (err) {
    console.warn("[whales] on-demand refresh failed:", err);
    return snapshot;
  }

  return getWhaleLiveSnapshot();
}

function isCompleteLiveSnapshot(snapshot: WhaleLiveSnapshot): boolean {
  return snapshot.source === "multi";
}

async function forEachWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) return;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function heatForPosition(args: {
  notionalUsd: number;
  unrealizedPnlPct: number | null;
  lastSeenAtMs: number;
}): number {
  const fresh = isSourceFresh(args.lastSeenAtMs) ? 100 : -250;
  const notional = Math.min(300, args.notionalUsd / 1000);
  const pnl = Math.max(-100, Math.min(100, args.unrealizedPnlPct ?? 0));
  return Math.round(500 + fresh + notional + pnl);
}

function parseStat(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isCopyableOnPacifica(
  position: WhaleLiveSnapshot["positions"][number],
): boolean {
  return position.raw.copyableOnPacifica !== false;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
}

function maxLeverageForCopy(
  position: WhaleLiveSnapshot["positions"][number],
): number {
  const rawPosition = record(position.raw.position);
  const rawLeverage = record(rawPosition?.leverage);
  return (
    positiveNumber(position.raw.pacificaMaxLeverage) ??
    positiveNumber(position.raw.maxLeverage) ??
    positiveNumber(rawPosition?.maxLeverage) ??
    positiveNumber(rawLeverage?.maxLeverage) ??
    Math.max(1, position.leverage)
  );
}

function openedAtKnown(position: WhaleLiveSnapshot["positions"][number]): boolean {
  if (position.source !== "hyperliquid") return true;
  return position.raw?.openedAtSource === "source";
}

async function getCachedPnlCurve(
  account: string,
  stats: {
    pnlAllTimeUsdc: number;
    pnl30dUsdc: number;
    pnl7dUsdc: number;
    pnl1dUsdc: number;
  },
): Promise<WhalePnlPoint[]> {
  const now = Date.now();
  const cached = pnlHistoryCache.get(account);
  if (cached && cached.expiresAt > now) return cached.curve;

  const history = await getPositionsHistory(account, PNL_HISTORY_LIMIT).catch(
    () => [],
  );
  const curve = buildWhalePnlCurve({
    history,
    pnlAllTimeUsdc: stats.pnlAllTimeUsdc,
    pnl30dUsdc: stats.pnl30dUsdc,
    pnl7dUsdc: stats.pnl7dUsdc,
    pnl1dUsdc: stats.pnl1dUsdc,
    nowMs: now,
  });
  pnlHistoryCache.set(account, {
    expiresAt: now + PNL_HISTORY_CACHE_MS,
    curve,
  });
  return curve;
}

function statsForLeaderboardEntry(entry: PacificaLeaderboardEntry | undefined) {
  return {
    equityUsdc: parseStat(entry?.equity_current),
    openInterestUsdc: parseStat(entry?.oi_current),
    pnl1dUsdc: parseStat(entry?.pnl_1d),
    pnl7dUsdc: parseStat(entry?.pnl_7d),
    pnl30dUsdc: parseStat(entry?.pnl_30d),
    pnlAllTimeUsdc: parseStat(entry?.pnl_all_time),
    winRatePct1d: null,
    totalCloses1d: 0,
    volume1dUsdc: parseStat(entry?.volume_1d),
  };
}

function lastHistoryNumber(
  history: Array<[number, string]> | undefined,
): number {
  const last = history?.[history.length - 1];
  if (!last) return 0;
  return parseStat(last[1]);
}

function portfolioWindow(
  portfolio: HLPortfolio,
  key: string,
): HLPortfolioWindow | undefined {
  return portfolio.find(([window]) => window === key)?.[1];
}

function curveFromPortfolioWindow(
  window: HLPortfolioWindow | undefined,
): WhalePnlPoint[] {
  if (!window) return [];
  return window.pnlHistory
    .map(([t, value]) => ({ t: Number(t), v: parseStat(value) }))
    .filter((point) => Number.isFinite(point.t));
}

function statsForHyperliquidPortfolio(
  portfolio: HLPortfolio | undefined,
  openPositions: WhalePositionSignal[],
) {
  const windows = portfolio ?? [];
  const day = portfolioWindow(windows, "day");
  const week = portfolioWindow(windows, "week");
  const month = portfolioWindow(windows, "month");
  const allTime =
    portfolioWindow(windows, "allTime") ??
    portfolioWindow(windows, "all");
  const openInterestUsdc = openPositions.reduce(
    (sum, position) => sum + position.payload.notionalUsd,
    0,
  );

  if (windows.length === 0) {
    return {
      equityUsdc: 0,
      openInterestUsdc,
      pnl1dUsdc: 0,
      pnl7dUsdc: 0,
      pnl30dUsdc: 0,
      pnlAllTimeUsdc: estimateLiveOpenPnlUsd(openPositions),
      winRatePct1d: null,
      totalCloses1d: 0,
      volume1dUsdc: 0,
      pnlCurve: [],
      statsSource: "live_positions" as const,
    };
  }

  return {
    equityUsdc:
      lastHistoryNumber(allTime?.accountValueHistory) ||
      lastHistoryNumber(day?.accountValueHistory),
    openInterestUsdc,
    pnl1dUsdc: lastHistoryNumber(day?.pnlHistory),
    pnl7dUsdc: lastHistoryNumber(week?.pnlHistory),
    pnl30dUsdc: lastHistoryNumber(month?.pnlHistory),
    pnlAllTimeUsdc: lastHistoryNumber(allTime?.pnlHistory),
    winRatePct1d: null,
    totalCloses1d: 0,
    volume1dUsdc: parseStat(day?.vlm),
    pnlCurve: curveFromPortfolioWindow(allTime),
    statsSource: "portfolio" as const,
  };
}

function estimateLiveOpenPnlUsd(openPositions: WhalePositionSignal[]): number {
  return openPositions.reduce((sum, position) => {
    const pnlPct = position.payload.unrealizedPnlPct;
    const leverage = position.payload.leverage;
    if (pnlPct === null || !Number.isFinite(leverage) || leverage <= 0) {
      return sum;
    }
    const marginUsd = position.payload.notionalUsd / leverage;
    return sum + (marginUsd * pnlPct) / 100;
  }, 0);
}

async function getAnalysisByPositionId(
  positionIds: string[],
): Promise<Map<string, typeof whalePositionAnalysis.$inferSelect>> {
  if (positionIds.length === 0) return new Map();

  const rows = await db
    .select()
    .from(whalePositionAnalysis)
    .where(inArray(whalePositionAnalysis.positionId, positionIds))
    .limit(positionIds.length);

  return new Map(rows.map((row) => [row.positionId, row]));
}

function shouldServeStaleSnapshot(snapshot: WhaleLiveSnapshot): boolean {
  return !isSourceFresh(snapshot.observedAt.getTime());
}

async function buildWhalePositionSignalsFromSnapshot(
  snapshot: WhaleLiveSnapshot,
  limit: number,
  options: { includeStalePositions?: boolean } = {},
): Promise<WhalePositionSignal[]> {
  const nowMs = Date.now();
  const whaleById = new Map(snapshot.whales.map((whale) => [whale.id, whale]));
  const livePositions = [...snapshot.positions]
    .filter((position) => position.status === "open")
    .filter(
      (position) =>
        options.includeStalePositions ||
        isSourceFresh(position.lastSeenAt.getTime(), undefined, nowMs) ||
        isRecentlyOpenedPosition(position.openedAt.getTime(), nowMs),
    )
    .filter((position) => isFlashCopyableMarket(position.market))
    .filter((position) => whaleById.get(position.whaleId)?.status === "active")
    .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
    .slice(0, limit);
  const analysisById = await getAnalysisByPositionId(
    livePositions.map((position) => position.id),
  );
  const stamp = new Date().toISOString();

  return livePositions.flatMap((position) => {
    const whale = whaleById.get(position.whaleId);
    if (!whale || whale.status !== "active") return [];

    const analysis = analysisById.get(position.id) ?? null;
    const openedAtMs = position.openedAt.getTime();
    const lastSeenAtMs = position.lastSeenAt.getTime();
    const stale = !isSourceFresh(lastSeenAtMs);
    const positionAnalysis = analysis
      ? {
          summary: analysis.summary,
          thesis: analysis.thesis,
          risk: analysis.risk,
          entryGapWarning: analysis.entryGapWarning,
          confidence: analysis.confidence,
        }
      : {
          ...fallbackWhaleAnalysis({
            displayName: whale.displayName,
            source: whale.source,
            market: position.market,
            side: position.side,
            leverage: position.leverage,
            entryPrice: position.entryPrice,
            currentMark: position.currentMark,
            notionalUsd: position.notionalUsd,
            openedAtMs,
          }),
          entryGapWarning: whaleEntryGapWarning({
            side: position.side,
            sourceEntry: position.entryPrice,
            currentMark: position.currentMark,
          }),
        };

    return {
      id: `whale_position:${position.id}`,
      type: "whale_position",
      heatScore: heatForPosition({
        notionalUsd: position.notionalUsd,
        unrealizedPnlPct: position.unrealizedPnlPct,
        lastSeenAtMs,
      }),
      createdAt: stamp,
      chips: [],
      payload: {
        positionId: position.id,
        whaleId: whale.id,
        source: whale.source,
        sourceAccount: whale.sourceAccount,
        displayName: whale.displayName,
        avatarUrl: whale.avatarUrl,
        market: position.market,
        side: position.side,
        leverage: position.leverage,
        maxLeverage: maxLeverageForCopy(position),
        amountBase: position.amountBase,
        notionalUsd: position.notionalUsd,
        entryPrice: position.entryPrice,
        currentMark: position.currentMark,
        unrealizedPnlPct: position.unrealizedPnlPct,
        openedAtMs,
        openedAtKnown: openedAtKnown(position),
        lastSeenAtMs,
        stale,
        copyableOnPacifica: isCopyableOnPacifica(position),
        analysis: positionAnalysis,
      },
    } satisfies WhalePositionSignal;
  });
}

function isRecentlyOpenedPosition(openedAtMs: number, nowMs: number): boolean {
  return nowMs - openedAtMs < RECENT_POSITION_STALE_GRACE_MS;
}

export async function buildWhalePositionSignals(
  limit = 100,
): Promise<WhalePositionSignal[]> {
  const snapshot = await getWhaleLiveSnapshotOrRefresh();
  if (snapshot === null) return [];
  return buildWhalePositionSignalsFromSnapshot(snapshot, limit, {
    includeStalePositions: shouldServeStaleSnapshot(snapshot),
  });
}

async function buildWhaleTraderSignalsFromSnapshot(
  snapshot: WhaleLiveSnapshot,
  includeRemoteStats: boolean,
): Promise<WhaleTraderSignal[]> {
  const activeWhales = snapshot.whales.filter(
    (whale) => whale.status === "active",
  );
  const positions = await buildWhalePositionSignalsFromSnapshot(snapshot, 1000, {
    includeStalePositions: shouldServeStaleSnapshot(snapshot),
  });
  const leaderboard = includeRemoteStats
    ? await getLeaderboard().catch(() => [] as PacificaLeaderboardEntry[])
    : [];
  const leaderboardByAccount = new Map(
    leaderboard.map((entry) => [entry.address, entry]),
  );
  const pnlCurveByAccount = new Map<string, WhalePnlPoint[]>();
  const portfolioByAccount = new Map<string, HLPortfolio>();

  if (includeRemoteStats) {
    await forEachWithConcurrency(
      activeWhales,
      PNL_HISTORY_CONCURRENCY,
      async (whale) => {
        if (whale.source !== "pacifica") return;
        const stats = statsForLeaderboardEntry(
          leaderboardByAccount.get(whale.sourceAccount),
        );
        pnlCurveByAccount.set(
          whale.sourceAccount,
          await getCachedPnlCurve(whale.sourceAccount, stats),
        );
      },
    );

    await forEachWithConcurrency(
      activeWhales,
      PNL_HISTORY_CONCURRENCY,
      async (whale) => {
        if (whale.source !== "hyperliquid") return;
        portfolioByAccount.set(
          whale.sourceAccount,
          await getPortfolio(whale.sourceAccount).catch(() => []),
        );
      },
    );
  }

  const byWhale = new Map<string, WhalePositionSignal[]>();

  for (const position of positions) {
    const list = byWhale.get(position.payload.whaleId) ?? [];
    list.push(position);
    byWhale.set(position.payload.whaleId, list);
  }

  const signals: WhaleTraderSignal[] = [];
  const stamp = new Date().toISOString();

  for (const whale of activeWhales) {
    const list = byWhale.get(whale.id) ?? [];
    const sortedPositions = [...list].sort((a, b) => b.heatScore - a.heatScore);
    const best = sortedPositions[0];
    const lastSeenAtMs =
      list.length > 0
        ? Math.max(...list.map((position) => position.payload.lastSeenAtMs))
        : null;

    const stats: WhaleTraderStats =
      whale.source === "hyperliquid"
        ? statsForHyperliquidPortfolio(
            portfolioByAccount.get(whale.sourceAccount),
            sortedPositions,
          )
        : {
            ...statsForLeaderboardEntry(
              leaderboardByAccount.get(whale.sourceAccount),
            ),
            pnlCurve: pnlCurveByAccount.get(whale.sourceAccount) ?? [],
          };

    signals.push({
      id: `whale_trader:${whale.id}`,
      type: "whale_trader",
      heatScore: best ? best.heatScore + list.length * 25 : 100,
      createdAt: stamp,
      chips: [],
      payload: {
        whaleId: whale.id,
        source: whale.source as "pacifica" | "hyperliquid",
        sourceAccount: whale.sourceAccount,
        displayName: whale.displayName,
        avatarUrl: whale.avatarUrl,
        tags: whale.tags,
        openPositionsCount: list.length,
        openPositions: sortedPositions.map((position) => position.payload),
        bestPosition: best?.payload ?? null,
        stats,
        lastSeenAt:
          lastSeenAtMs === null ? null : new Date(lastSeenAtMs).toISOString(),
        stale:
          list.length === 0 || list.every((position) => position.payload.stale),
      },
    });
  }

  return signals.sort((a, b) => b.heatScore - a.heatScore);
}

export async function buildWhaleTraderSignals(): Promise<WhaleTraderSignal[]> {
  const snapshot = await getWhaleLiveSnapshotOrRefresh();
  if (snapshot === null) return [];
  return buildWhaleTraderSignalsFromSnapshot(snapshot, true);
}

async function buildLocalWhaleTraderSignals(): Promise<WhaleTraderSignal[]> {
  const snapshot = await getWhaleLiveSnapshot().catch(() => null);
  if (snapshot === null) return [];
  return buildWhaleTraderSignalsFromSnapshot(snapshot, false);
}

async function refreshCachedWhaleTraderSignals(): Promise<WhaleTraderSignal[]> {
  if (!traderSignalsInFlight) {
    traderSignalsInFlight = buildWhaleTraderSignals()
      .then((signals) => {
        const now = Date.now();
        const cacheMs =
          signals.length === 0
            ? TRADER_SIGNALS_EMPTY_CACHE_MS
            : TRADER_SIGNALS_CACHE_MS;
        traderSignalsCache = {
          signals,
          expiresAt: now + cacheMs,
          staleUntil:
            now +
            (signals.length === 0 ? cacheMs : TRADER_SIGNALS_STALE_MS),
        };
        return signals;
      })
      .finally(() => {
        traderSignalsInFlight = null;
      });
  }

  return traderSignalsInFlight;
}

async function refreshCachedWhaleTraderSignalsWithinBudget(): Promise<
  WhaleTraderSignal[]
> {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      refreshCachedWhaleTraderSignals(),
      new Promise<WhaleTraderSignal[]>((resolve) => {
        timeout = setTimeout(() => {
          resolve(buildLocalWhaleTraderSignals());
        }, TRADER_SIGNALS_COLD_START_BUDGET_MS);
      }),
    ]);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

export async function buildCachedWhaleTraderSignals(): Promise<
  WhaleTraderSignal[]
> {
  const now = Date.now();
  if (traderSignalsCache && traderSignalsCache.expiresAt > now) {
    return traderSignalsCache.signals;
  }

  if (traderSignalsCache && traderSignalsCache.staleUntil > now) {
    void refreshCachedWhaleTraderSignals().catch((err) => {
      console.warn("[whales] roster cache refresh failed:", err);
    });
    return traderSignalsCache.signals;
  }

  try {
    return await refreshCachedWhaleTraderSignalsWithinBudget();
  } catch (err) {
    if (traderSignalsCache) return traderSignalsCache.signals;
    throw err;
  }
}

export function clearWhaleSignalCachesForTests(): void {
  pnlHistoryCache.clear();
  traderSignalsCache = null;
  traderSignalsInFlight = null;
  liveRefreshInFlight = null;
}
