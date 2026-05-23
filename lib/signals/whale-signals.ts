import { db } from "@/lib/db";
import {
  whales,
  whalePositionAnalysis,
  whalePositions,
} from "@/lib/db/schema";
import { isSourceFresh } from "@/lib/whales/identity";
import { desc, eq } from "drizzle-orm";
import type { WhalePositionSignal, WhaleTraderSignal } from "@/lib/types";

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
    .where(eq(whalePositions.status, "open"))
    .orderBy(desc(whalePositions.lastSeenAt))
    .limit(limit);

  const stamp = new Date().toISOString();

  return rows.map(({ position, whale, analysis }) => {
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
  const positions = await buildWhalePositionSignals(200);
  const byWhale = new Map<string, WhalePositionSignal[]>();

  for (const position of positions) {
    const list = byWhale.get(position.payload.whaleId) ?? [];
    list.push(position);
    byWhale.set(position.payload.whaleId, list);
  }

  const signals: WhaleTraderSignal[] = [];
  const stamp = new Date().toISOString();

  for (const [whaleId, list] of byWhale) {
    const best = [...list].sort((a, b) => b.heatScore - a.heatScore)[0];
    if (!best) continue;

    const lastSeenAtMs = Math.max(
      ...list.map((position) => position.payload.lastSeenAtMs),
    );

    signals.push({
      id: `whale_trader:${whaleId}`,
      type: "whale_trader",
      heatScore: best.heatScore + list.length * 25,
      createdAt: stamp,
      chips: [],
      payload: {
        whaleId,
        source: best.payload.source,
        sourceAccount: best.payload.sourceAccount,
        displayName: best.payload.displayName,
        avatarUrl: best.payload.avatarUrl,
        tags: [],
        openPositionsCount: list.length,
        bestPosition: best.payload,
        stats: {
          pnl1dUsdc: 0,
          pnl7dUsdc: 0,
          pnl30dUsdc: 0,
          winRatePct1d: null,
          totalCloses1d: 0,
          volume1dUsdc: 0,
        },
        lastSeenAt: new Date(lastSeenAtMs).toISOString(),
        stale: list.every((position) => position.payload.stale),
      },
    });
  }

  return signals.sort((a, b) => b.heatScore - a.heatScore);
}
