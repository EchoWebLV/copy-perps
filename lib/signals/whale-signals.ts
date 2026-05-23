import { db } from "@/lib/db";
import {
  whales,
  whalePositionAnalysis,
  whalePositions,
} from "@/lib/db/schema";
import { isSourceFresh } from "@/lib/whales/identity";
import { and, desc, eq } from "drizzle-orm";
import type { WhalePositionSignal, WhaleTraderSignal } from "@/lib/types";
import { getLeaderboard } from "@/lib/pacifica/client";
import type { PacificaLeaderboardEntry } from "@/lib/pacifica/types";

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

export async function buildWhalePositionSignals(
  limit = 100,
): Promise<WhalePositionSignal[]> {
  const rows = await db
    .select({
      position: whalePositions,
      whale: whales,
      analysis: whalePositionAnalysis,
    })
    .from(whalePositions)
    .innerJoin(whales, eq(whalePositions.whaleId, whales.id))
    .leftJoin(
      whalePositionAnalysis,
      eq(whalePositionAnalysis.positionId, whalePositions.id),
    )
    .where(and(eq(whalePositions.status, "open"), eq(whales.status, "active")))
    .orderBy(desc(whalePositions.lastSeenAt))
    .limit(limit);

  const stamp = new Date().toISOString();

  return rows
    .filter(({ whale }) => whale.status === "active")
    .map(({ position, whale, analysis }) => {
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
          source: whale.source as "pacifica" | "hyperliquid",
          sourceAccount: whale.sourceAccount,
          displayName: whale.displayName,
          avatarUrl: whale.avatarUrl,
          market: position.market,
          side: position.side as "long" | "short",
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

export async function buildWhaleTraderSignals(): Promise<WhaleTraderSignal[]> {
  const [positions, activeWhales, leaderboard] = await Promise.all([
    buildWhalePositionSignals(1000),
    db
      .select()
      .from(whales)
      .where(eq(whales.status, "active"))
      .limit(500),
    getLeaderboard().catch(() => [] as PacificaLeaderboardEntry[]),
  ]);
  const leaderboardByAccount = new Map(
    leaderboard.map((entry) => [entry.address, entry]),
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
        stats: statsForLeaderboardEntry(
          whale.source === "pacifica"
            ? leaderboardByAccount.get(whale.sourceAccount)
            : undefined,
        ),
        lastSeenAt:
          lastSeenAtMs === null ? null : new Date(lastSeenAtMs).toISOString(),
        stale:
          list.length === 0 || list.every((position) => position.payload.stale),
      },
    });
  }

  return signals.sort((a, b) => b.heatScore - a.heatScore);
}
