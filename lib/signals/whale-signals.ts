import { db } from "@/lib/db";
import { whalePositionAnalysis } from "@/lib/db/schema";
import { isSourceFresh } from "@/lib/whales/identity";
import { inArray } from "drizzle-orm";
import type { WhalePositionSignal, WhaleTraderSignal } from "@/lib/types";
import { getLeaderboard, getPositionsHistory } from "@/lib/pacifica/client";
import type { PacificaLeaderboardEntry } from "@/lib/pacifica/types";
import {
  buildWhalePnlCurve,
  type WhalePnlPoint,
} from "@/lib/whales/pnl-curve";
import {
  getWhaleLiveSnapshot,
  type WhaleLiveSnapshot,
} from "@/lib/whales/live-cache";
import { refreshPacificaWhales } from "@/lib/whales/refresh-pacifica";

const PNL_HISTORY_LIMIT = 500;
const PNL_HISTORY_CACHE_MS = 5 * 60_000;
const PNL_HISTORY_CONCURRENCY = 4;

const pnlHistoryCache = new Map<
  string,
  { expiresAt: number; curve: WhalePnlPoint[] }
>();
let liveRefreshInFlight: Promise<void> | null = null;

async function refreshLiveSnapshotOnce(): Promise<void> {
  if (!liveRefreshInFlight) {
    liveRefreshInFlight = refreshPacificaWhales()
      .then(() => undefined)
      .finally(() => {
        liveRefreshInFlight = null;
      });
  }

  await liveRefreshInFlight;
}

async function getWhaleLiveSnapshotOrRefresh(): Promise<WhaleLiveSnapshot | null> {
  const snapshot = await getWhaleLiveSnapshot();
  if (snapshot !== null && isSourceFresh(snapshot.observedAt.getTime())) {
    return snapshot;
  }

  try {
    await refreshLiveSnapshotOnce();
  } catch (err) {
    console.warn("[whales] on-demand refresh failed:", err);
    return snapshot;
  }

  return getWhaleLiveSnapshot();
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

async function buildWhalePositionSignalsFromSnapshot(
  snapshot: WhaleLiveSnapshot,
  limit: number,
): Promise<WhalePositionSignal[]> {
  const whaleById = new Map(snapshot.whales.map((whale) => [whale.id, whale]));
  const livePositions = [...snapshot.positions]
    .filter((position) => position.status === "open")
    .filter((position) => isSourceFresh(position.lastSeenAt.getTime()))
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
        amountBase: position.amountBase,
        notionalUsd: position.notionalUsd,
        entryPrice: position.entryPrice,
        currentMark: position.currentMark,
        unrealizedPnlPct: position.unrealizedPnlPct,
        openedAtMs,
        lastSeenAtMs,
        stale,
        analysis: analysis
          ? {
              summary: analysis.summary,
              thesis: analysis.thesis,
              risk: analysis.risk,
              entryGapWarning: analysis.entryGapWarning,
              confidence: analysis.confidence,
            }
          : null,
      },
    } satisfies WhalePositionSignal;
  });
}

export async function buildWhalePositionSignals(
  limit = 100,
): Promise<WhalePositionSignal[]> {
  const snapshot = await getWhaleLiveSnapshotOrRefresh();
  if (snapshot === null) return [];
  return buildWhalePositionSignalsFromSnapshot(snapshot, limit);
}

export async function buildWhaleTraderSignals(): Promise<WhaleTraderSignal[]> {
  const snapshot = await getWhaleLiveSnapshotOrRefresh();
  if (snapshot === null) return [];

  const activeWhales = snapshot.whales.filter(
    (whale) => whale.status === "active",
  );
  const [positions, leaderboard] = await Promise.all([
    buildWhalePositionSignalsFromSnapshot(snapshot, 1000),
    getLeaderboard().catch(() => [] as PacificaLeaderboardEntry[]),
  ]);
  const leaderboardByAccount = new Map(
    leaderboard.map((entry) => [entry.address, entry]),
  );
  const pnlCurveByAccount = new Map<string, WhalePnlPoint[]>();

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
        stats: {
          ...statsForLeaderboardEntry(
            whale.source === "pacifica"
              ? leaderboardByAccount.get(whale.sourceAccount)
              : undefined,
          ),
          pnlCurve: pnlCurveByAccount.get(whale.sourceAccount) ?? [],
        },
        lastSeenAt:
          lastSeenAtMs === null ? null : new Date(lastSeenAtMs).toISOString(),
        stale:
          list.length === 0 || list.every((position) => position.payload.stale),
      },
    });
  }

  return signals.sort((a, b) => b.heatScore - a.heatScore);
}
